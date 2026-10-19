package fontgen

import (
	"bytes"
	"encoding/binary"
	"io"
	"os"
	"testing"

	"github.com/andybalholm/brotli"
	"golang.org/x/image/font/sfnt"

	"github.com/GeekFreak01/spline/internal/project"
)

func formsProject() *project.Project {
	p := testProject()
	box := func(w float64) []project.Contour {
		return []project.Contour{{Closed: true, Nodes: []project.Node{{X: 50, Y: 0}, {X: w, Y: 0}, {X: w, Y: 500}, {X: 50, Y: 500}}}}
	}
	add := func(name string, u int, w float64) {
		p.Glyphs = append(p.Glyphs, project.Glyph{Name: name, Unicode: u, Advance: w + 50, Contours: box(w)})
	}
	add("a", 'a', 400)
	add("A", 'A', 500)
	add("a.sc", 0, 420)
	add("one", '1', 300)
	add("one.onum", 0, 310)
	add("be", 'б', 450)
	add("be.loclBGR", 0, 460)
	add("g.ss01", 0, 470)
	add("g", 'g', 440)
	p.Info.ItalicAngle = -12
	p.Info.Weight = 700
	p.Info.Copyright = "(c) Test"
	return p
}

func TestFormsAndWOFF(t *testing.T) {
	ttf, err := Build(formsProject(), TTF)
	if err != nil {
		t.Fatal(err)
	}
	woff, err := Build(formsProject(), WOFF)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(woff, []byte("wOFF")) || len(woff) >= len(ttf) {
		t.Errorf("woff: %d bytes vs ttf %d", len(woff), len(ttf))
	}
	woff2, err := Build(formsProject(), WOFF2)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(woff2, []byte("wOF2")) || len(woff2) >= len(woff) {
		t.Errorf("woff2: %d bytes vs woff %d", len(woff2), len(woff))
	}
	// The Brotli stream holds the tables of the TTF, one after another.
	n := int(binary.BigEndian.Uint16(ttf[4:]))
	var want []byte
	for i := 0; i < n; i++ {
		e := ttf[12+16*i:]
		off, l := binary.BigEndian.Uint32(e[8:]), binary.BigEndian.Uint32(e[12:])
		want = append(want, ttf[off:off+l]...)
	}
	// Walk the table directory to where the compressed data starts.
	pos := 48
	for i := 0; i < n; i++ {
		if woff2[pos]&63 == 63 {
			pos += 4
		}
		pos++
		for woff2[pos]&0x80 != 0 {
			pos++
		}
		pos++
	}
	size := int(binary.BigEndian.Uint32(woff2[20:]))
	got, err := io.ReadAll(brotli.NewReader(bytes.NewReader(woff2[pos : pos+size])))
	if err != nil || !bytes.Equal(got, want) {
		t.Errorf("woff2 stream: %v, %d bytes, want %d", err, len(got), len(want))
	}
	if out := os.Getenv("SPLINE_FONT_OUT"); out != "" {
		os.WriteFile(out, ttf, 0o644)
		os.WriteFile(out+".woff", woff, 0o644)
		os.WriteFile(out+".woff2", woff2, 0o644)
	}
}

func TestNoExport(t *testing.T) {
	p := formsProject()
	for i := range p.Glyphs {
		if p.Glyphs[i].Name == "g" {
			p.Glyphs[i].NoExport = true
		}
	}
	data, err := Build(p, TTF)
	if err != nil {
		t.Fatal(err)
	}
	f, err := sfnt.Parse(data)
	if err != nil {
		t.Fatal(err)
	}
	var buf sfnt.Buffer
	if gi, _ := f.GlyphIndex(&buf, 'g'); gi != 0 {
		t.Error("a glyph marked noExport is in the font")
	}
}

func TestColorFont(t *testing.T) {
	p := formsProject()
	p.Palette = []string{"#E53935", "#1E88E5"}
	for i := range p.Glyphs {
		if p.Glyphs[i].Name == "O" {
			p.Glyphs[i].Contours[0].Paint = 1 // the ring red, the counter in the text colour
		}
	}
	data, err := Build(p, TTF)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(data[:400], []byte("COLR")) || !bytes.Contains(data[:400], []byte("CPAL")) {
		t.Error("no COLR/CPAL")
	}
	if out := os.Getenv("SPLINE_FONT_OUT"); out != "" {
		os.WriteFile(out+".color.ttf", data, 0o644)
	}
}
