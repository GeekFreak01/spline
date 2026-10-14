// Command genicons renders the logo and the document icon from assets/*.svg
// and embeds them into the Windows executable as resources.
//
// Run from the repository root after changing assets/logo.svg or
// assets/file.svg:
//
//	go generate
//
// It writes:
//
//	rsrc_windows_*.syso   icons + version info, linked into spline.exe
//	assets/spline.ico     application icon
//	assets/spline-file.ico  icon for .sp files
//	assets/logo.png       512 px logo (README, store pages)
//	web/favicon.svg       copy of the logo for the editor
//	installer/*.bmp       pictures for the setup wizard
package main

import (
	"bytes"
	"flag"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"log"
	"os"

	"github.com/srwiley/oksvg"
	"github.com/srwiley/rasterx"
	"github.com/tc-hib/winres"
	"github.com/tc-hib/winres/version"
	"golang.org/x/image/bmp"
	xdraw "golang.org/x/image/draw"
)

var sizes = []int{16, 20, 24, 32, 40, 48, 64, 96, 128, 256}

// render draws the SVG once at a large size and scales it down with a good
// filter: rasterizing tiny sizes directly gets stroke widths wrong.
func render(svg []byte, size int) image.Image {
	const big = 512
	icon, err := oksvg.ReadIconStream(bytes.NewReader(svg), oksvg.WarnErrorMode)
	if err != nil {
		log.Fatal(err)
	}
	icon.SetTarget(0, 0, big, big)
	src := image.NewRGBA(image.Rect(0, 0, big, big))
	scanner := rasterx.NewScannerGV(big, big, src, src.Bounds())
	icon.Draw(rasterx.NewDasher(big, big, scanner), 1)
	if size == big {
		return src
	}
	dst := image.NewRGBA(image.Rect(0, 0, size, size))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), src, src.Bounds(), draw.Over, nil)
	return dst
}

func makeIcon(svg []byte) *winres.Icon {
	var imgs []image.Image
	for _, s := range sizes {
		imgs = append(imgs, render(svg, s))
	}
	icon, err := winres.NewIconFromImages(imgs)
	if err != nil {
		log.Fatal(err)
	}
	return icon
}

func writeICO(path string, icon *winres.Icon) {
	f, err := os.Create(path)
	if err != nil {
		log.Fatal(err)
	}
	defer f.Close()
	if err := icon.SaveICO(f); err != nil {
		log.Fatal(err)
	}
}

// writePreview saves small sizes enlarged 4x (nearest neighbour) on a dark
// background, to check how the icons read at 16-48 px.
func writePreview(path string, svgs ...[]byte) {
	const zoom = 4
	small := []int{16, 24, 32, 48}
	w := 8
	for _, s := range small {
		w += (s*zoom + 8) * len(svgs)
	}
	sheet := image.NewRGBA(image.Rect(0, 0, w, 48*zoom+16))
	draw.Draw(sheet, sheet.Bounds(), &image.Uniform{color.RGBA{40, 40, 40, 255}}, image.Point{}, draw.Src)
	x := 8
	for _, svg := range svgs {
		for _, s := range small {
			img := render(svg, s)
			for py := 0; py < s*zoom; py++ {
				for px := 0; px < s*zoom; px++ {
					c := img.At(px/zoom, py/zoom)
					sheet.Set(x+px, 8+py, blend(sheet.At(x+px, 8+py), c))
				}
			}
			x += s*zoom + 8
		}
	}
	f, err := os.Create(path)
	if err != nil {
		log.Fatal(err)
	}
	defer f.Close()
	png.Encode(f, sheet)
}

func blend(dst, src color.Color) color.Color {
	sr, sg, sb, sa := src.RGBA()
	dr, dg, db, _ := dst.RGBA()
	a := 0xffff - sa
	return color.RGBA64{uint16(sr + dr*a/0xffff), uint16(sg + dg*a/0xffff), uint16(sb + db*a/0xffff), 0xffff}
}

// wizardImage draws the logo of the given size on a solid background
// (Inno Setup wants opaque bitmaps) and saves it as BMP.
func wizardImage(path string, logo []byte, w, h, size, top int, bg0, bg1 color.RGBA) {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		t := float64(y) / float64(max(1, h-1))
		c := color.RGBA{
			uint8(float64(bg0.R) + (float64(bg1.R)-float64(bg0.R))*t),
			uint8(float64(bg0.G) + (float64(bg1.G)-float64(bg0.G))*t),
			uint8(float64(bg0.B) + (float64(bg1.B)-float64(bg0.B))*t), 255,
		}
		draw.Draw(img, image.Rect(0, y, w, y+1), &image.Uniform{c}, image.Point{}, draw.Src)
	}
	l := render(logo, size)
	x0 := (w - size) / 2
	draw.Draw(img, image.Rect(x0, top, x0+size, top+size), l, image.Point{}, draw.Over)
	f, err := os.Create(path)
	if err != nil {
		log.Fatal(err)
	}
	defer f.Close()
	if err := bmp.Encode(f, img); err != nil {
		log.Fatal(err)
	}
}

func main() {
	preview := flag.String("preview", "", "only write an enlarged preview of the small sizes to this PNG")
	flag.Parse()
	logo, err := os.ReadFile("assets/logo.svg")
	if err != nil {
		log.Fatal("run from the repository root: ", err)
	}
	doc, err := os.ReadFile("assets/file.svg")
	if err != nil {
		log.Fatal(err)
	}

	if *preview != "" {
		writePreview(*preview, logo, doc)
		return
	}

	appIcon, docIcon := makeIcon(logo), makeIcon(doc)
	writeICO("assets/spline.ico", appIcon)
	writeICO("assets/spline-file.ico", docIcon)

	var buf bytes.Buffer
	if err := png.Encode(&buf, render(logo, 512)); err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile("assets/logo.png", buf.Bytes(), 0o644); err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile("web/favicon.svg", logo, 0o644); err != nil {
		log.Fatal(err)
	}

	// Setup wizard: header image (100% and 200% DPI) and the side panel.
	white := color.RGBA{255, 255, 255, 255}
	dark0, dark1 := color.RGBA{43, 43, 43, 255}, color.RGBA{24, 24, 24, 255}
	wizardImage("installer/wizard-small.bmp", logo, 55, 55, 51, 2, white, white)
	wizardImage("installer/wizard-small-2x.bmp", logo, 110, 110, 102, 4, white, white)
	wizardImage("installer/wizard.bmp", logo, 164, 314, 112, 70, dark0, dark1)
	wizardImage("installer/wizard-2x.bmp", logo, 328, 628, 224, 140, dark0, dark1)

	// Resource IDs: 1 = application (also the window icon), 2 = .sp files.
	rs := winres.ResourceSet{}
	if err := rs.SetIcon(winres.ID(1), appIcon); err != nil {
		log.Fatal(err)
	}
	if err := rs.SetIcon(winres.ID(2), docIcon); err != nil {
		log.Fatal(err)
	}
	var vi version.Info
	vi.Set(version.LangDefault, version.ProductName, "Spline")
	vi.Set(version.LangDefault, version.FileDescription, "Spline — font editor")
	vi.Set(version.LangDefault, version.CompanyName, "Spline contributors")
	vi.Set(version.LangDefault, version.LegalCopyright, "MIT License")
	vi.Set(version.LangDefault, version.OriginalFilename, "spline.exe")
	vi.SetFileVersion("1.0.0.0")
	vi.SetProductVersion("1.0.0.0")
	rs.SetVersionInfo(vi)

	for arch, name := range map[winres.Arch]string{
		winres.ArchAMD64: "rsrc_windows_amd64.syso",
		winres.ArchARM64: "rsrc_windows_arm64.syso",
	} {
		f, err := os.Create(name)
		if err != nil {
			log.Fatal(err)
		}
		if err := rs.WriteObject(f, arch); err != nil {
			log.Fatal(err)
		}
		f.Close()
	}
	log.Println("icons generated")
}
