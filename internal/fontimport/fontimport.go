// Package fontimport turns a ready TrueType/OpenType font into a Spline
// project, so a font made elsewhere can be opened and edited.
package fontimport

import (
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"

	"golang.org/x/image/font"
	"golang.org/x/image/font/sfnt"
	"golang.org/x/image/math/fixed"

	"github.com/GeekFreak01/spline/internal/project"
)

const (
	maxGlyphs     = 3000 // the editor stays responsive below this
	maxKernGlyphs = 500  // kerning is read pair by pair, so keep it bounded
)

// Result is the imported project plus what had to be left out.
type Result struct {
	Project *project.Project
	Skipped int // glyphs beyond maxGlyphs
}

// Import parses a .ttf/.otf file.
func Import(data []byte) (*Result, error) {
	f, err := sfnt.Parse(data)
	if err != nil {
		return nil, fmt.Errorf("not a TrueType/OpenType font: %w", err)
	}
	var buf sfnt.Buffer
	upm := int(f.UnitsPerEm())
	if upm < 16 || upm > 16384 {
		return nil, errors.New("unsupported units per em")
	}
	ppem := fixed.I(upm) // with ppem = upm, 26.6 values are font units
	units := func(v fixed.Int26_6) float64 { return float64(v) / 64 }

	p := &project.Project{Format: project.FormatName, Version: project.CurrentVersion}
	in := &p.Info
	in.UnitsPerEm = upm
	in.FamilyName = firstName(f, &buf, sfnt.NameIDTypographicFamily, sfnt.NameIDFamily)
	in.StyleName = firstName(f, &buf, sfnt.NameIDTypographicSubfamily, sfnt.NameIDSubfamily)
	in.FamilyName = clip(in.FamilyName, 60)
	in.StyleName = clip(in.StyleName, 40)
	in.Designer = clip(firstName(f, &buf, sfnt.NameIDDesigner), 80)
	if v := versionRe.FindString(firstName(f, &buf, sfnt.NameIDVersion)); v != "" {
		in.Version = v
	}
	if m, err := f.Metrics(&buf, ppem, font.HintingNone); err == nil {
		in.Ascender = int(math.Round(units(m.Ascent)))
		in.Descender = -int(math.Round(units(m.Descent)))
		in.XHeight = int(math.Round(units(m.XHeight)))
		in.CapHeight = int(math.Round(units(m.CapHeight)))
	}

	// Encoded glyphs first, in Unicode order, then the rest (alternates,
	// ligatures) in font order.
	type entry struct {
		gi  sfnt.GlyphIndex
		uni int
	}
	var order []entry
	seen := map[sfnt.GlyphIndex]bool{0: true} // .notdef is rebuilt on export
	for r := rune(0x20); r <= 0x2FFFF; r++ {
		if r >= 0xD800 && r <= 0xDFFF {
			continue
		}
		gi, err := f.GlyphIndex(&buf, r)
		if err != nil || gi == 0 || seen[gi] {
			continue
		}
		seen[gi] = true
		order = append(order, entry{gi, int(r)})
	}
	for i := 1; i < f.NumGlyphs(); i++ {
		if gi := sfnt.GlyphIndex(i); !seen[gi] {
			seen[gi] = true
			order = append(order, entry{gi, 0})
		}
	}
	res := &Result{Project: p}
	if len(order) > maxGlyphs {
		res.Skipped = len(order) - maxGlyphs
		order = order[:maxGlyphs]
	}

	names := map[string]bool{}
	nameOf := map[sfnt.GlyphIndex]string{}
	for _, e := range order {
		name := cleanName(f, &buf, e.gi)
		if name == "" || name == ".notdef" {
			if e.uni != 0 {
				name = fmt.Sprintf("uni%04X", e.uni)
			} else {
				name = fmt.Sprintf("glyph%d", e.gi)
			}
		}
		base := name
		for k := 2; names[name]; k++ {
			name = fmt.Sprintf("%s.%d", base, k)
		}
		names[name] = true
		nameOf[e.gi] = name
		adv, _ := f.GlyphAdvance(&buf, e.gi, ppem, font.HintingNone)
		contours := Contours(f, &buf, e.gi, upm)
		if contours == nil {
			contours = []project.Contour{}
		}
		p.Glyphs = append(p.Glyphs, project.Glyph{
			Name:     name,
			Unicode:  e.uni,
			Advance:  math.Max(0, math.Round(units(adv))),
			Contours: contours,
		})
	}

	// Kerning between letters, digits and punctuation that are drawn.
	var kg []sfnt.GlyphIndex
	for _, e := range order {
		if e.uni != 0 && e.uni > 0x20 && len(kg) < maxKernGlyphs {
			kg = append(kg, e.gi)
		}
	}
	for _, a := range kg {
		for _, b := range kg {
			k, err := f.Kern(&buf, a, b, ppem, font.HintingNone)
			if err != nil {
				if errors.Is(err, sfnt.ErrNotFound) {
					continue
				}
				break
			}
			if v := math.Round(units(k)); v != 0 && math.Abs(v) <= 5000 {
				if p.Kerning == nil {
					p.Kerning = map[string]map[string]float64{}
				}
				row := p.Kerning[nameOf[a]]
				if row == nil {
					row = map[string]float64{}
					p.Kerning[nameOf[a]] = row
				}
				row[nameOf[b]] = v
			}
		}
	}

	if err := p.Validate(); err != nil {
		return nil, err
	}
	return res, nil
}

var versionRe = regexp.MustCompile(`\d+\.\d+`)

func firstName(f *sfnt.Font, buf *sfnt.Buffer, ids ...sfnt.NameID) string {
	for _, id := range ids {
		if s, err := f.Name(buf, id); err == nil {
			if s = strings.TrimSpace(s); s != "" {
				return s
			}
		}
	}
	return ""
}

// cleanName returns the glyph's PostScript name if it is usable.
func cleanName(f *sfnt.Font, buf *sfnt.Buffer, gi sfnt.GlyphIndex) string {
	s, err := f.GlyphName(buf, gi)
	if err != nil || len(s) > 63 {
		return ""
	}
	for _, r := range s {
		if r <= ' ' || r > '~' {
			return ""
		}
	}
	return s
}

func r1(v float64) float64 { return math.Round(v*10) / 10 }

type pt struct{ x, y float64 }

func conv(p fixed.Point26_6) pt { return pt{float64(p.X) / 64, -float64(p.Y) / 64} }

// Contours converts a glyph's outline to project contours. Quadratic
// segments become cubic ones; a node is smooth when its handles line up.
// Coordinates are scaled to upm units per em.
func Contours(f *sfnt.Font, buf *sfnt.Buffer, gi sfnt.GlyphIndex, upm int) []project.Contour {
	segs, err := f.LoadGlyph(buf, gi, fixed.I(upm), nil)
	if err != nil {
		return nil
	}
	var out []project.Contour
	var cur *project.Contour
	var last pt
	flush := func() {
		if cur == nil || len(cur.Nodes) < 2 {
			return
		}
		n := cur.Nodes
		// The closing point repeats the start: merge them.
		if a, b := n[0], n[len(n)-1]; math.Abs(a.X-b.X) < 0.05 && math.Abs(a.Y-b.Y) < 0.05 {
			n[0].In = b.In
			n = n[:len(n)-1]
		}
		for i := range n {
			if n[i].In != nil && n[i].Out != nil {
				a := math.Atan2(n[i].Y-n[i].In.Y, n[i].X-n[i].In.X)
				b := math.Atan2(n[i].Out.Y-n[i].Y, n[i].Out.X-n[i].X)
				d := math.Abs(math.Atan2(math.Sin(a-b), math.Cos(a-b)))
				n[i].Smooth = d < 0.05
			}
		}
		cur.Nodes = n
		out = append(out, *cur)
	}
	node := func(p pt) project.Node { return project.Node{X: r1(p.x), Y: r1(p.y)} }
	for _, s := range segs {
		if cur == nil && s.Op != sfnt.SegmentOpMoveTo {
			continue
		}
		switch s.Op {
		case sfnt.SegmentOpMoveTo:
			flush()
			last = conv(s.Args[0])
			cur = &project.Contour{Closed: true, Nodes: []project.Node{node(last)}}
		case sfnt.SegmentOpLineTo:
			last = conv(s.Args[0])
			cur.Nodes = append(cur.Nodes, node(last))
		case sfnt.SegmentOpQuadTo:
			q, p := conv(s.Args[0]), conv(s.Args[1])
			c1 := pt{last.x + 2.0/3*(q.x-last.x), last.y + 2.0/3*(q.y-last.y)}
			c2 := pt{p.x + 2.0/3*(q.x-p.x), p.y + 2.0/3*(q.y-p.y)}
			prev := &cur.Nodes[len(cur.Nodes)-1]
			prev.Out = &project.Point{X: r1(c1.x), Y: r1(c1.y)}
			nd := node(p)
			nd.In = &project.Point{X: r1(c2.x), Y: r1(c2.y)}
			cur.Nodes = append(cur.Nodes, nd)
			last = p
		case sfnt.SegmentOpCubeTo:
			c1, c2, p := conv(s.Args[0]), conv(s.Args[1]), conv(s.Args[2])
			prev := &cur.Nodes[len(cur.Nodes)-1]
			prev.Out = &project.Point{X: r1(c1.x), Y: r1(c1.y)}
			nd := node(p)
			nd.In = &project.Point{X: r1(c2.x), Y: r1(c2.y)}
			cur.Nodes = append(cur.Nodes, nd)
			last = p
		}
	}
	flush()
	return out
}

func clip(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return strings.TrimSpace(string(r[:n]))
	}
	return s
}
