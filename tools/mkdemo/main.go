// Command mkdemo builds examples/demo.sp from the open "Go Regular" font
// (golang.org/x/image/font/gofont, BSD-style license by the Go Authors).
// The demo project is used for screenshots and as a richer example.
//
//	go run ./tools/mkdemo
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"os"

	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/goregular"
	"golang.org/x/image/font/sfnt"
	"golang.org/x/image/math/fixed"

	"github.com/GeekFreak01/spline/internal/project"
)

const upm = 1000

func r1(v float64) float64 { return math.Round(v*10) / 10 }

type pt struct{ x, y float64 }

func conv(p fixed.Point26_6) pt { return pt{float64(p.X) / 64, -float64(p.Y) / 64} }

func glyphContours(f *sfnt.Font, buf *sfnt.Buffer, gi sfnt.GlyphIndex) []project.Contour {
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

func main() {
	f, err := sfnt.Parse(goregular.TTF)
	if err != nil {
		log.Fatal(err)
	}
	var buf sfnt.Buffer
	m, _ := f.Metrics(&buf, fixed.I(upm), font.HintingNone)
	top := func(r rune) int {
		gi, _ := f.GlyphIndex(&buf, r)
		b, _, _ := f.GlyphBounds(&buf, gi, fixed.I(upm), font.HintingNone)
		return int(math.Round(-float64(b.Min.Y) / 64))
	}
	p := project.Project{
		Format: project.FormatName, Version: project.CurrentVersion,
		Info: project.Info{
			FamilyName: "Spline Demo", StyleName: "Regular", Version: "1.000",
			Designer:   "Outlines: Go Regular (c) The Go Authors, BSD-style license",
			UnitsPerEm: upm, Ascender: int(math.Round(float64(m.Ascent) / 64)),
			Descender: -int(math.Round(float64(m.Descent) / 64)),
			XHeight:   top('x'), CapHeight: top('H'),
		},
	}
	chars := "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz" +
		"АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя" +
		"0123456789 .,:;!?-–—'\"«»()[]/&@#%*+=_<>€$№"
	names := map[rune]string{' ': "space", '.': "period", ',': "comma", ':': "colon", ';': "semicolon", '!': "exclam",
		'?': "question", '-': "hyphen", '–': "endash", '—': "emdash", '\'': "quotesingle", '"': "quotedbl",
		'«': "guillemetleft", '»': "guillemetright", '(': "parenleft", ')': "parenright", '[': "bracketleft",
		']': "bracketright", '/': "slash", '&': "ampersand", '@': "at", '#': "numbersign", '%': "percent",
		'*': "asterisk", '+': "plus", '=': "equal", '_': "underscore", '<': "less", '>': "greater", '€': "Euro",
		'$': "dollar", '№': "numero", '0': "zero", '1': "one", '2': "two", '3': "three", '4': "four", '5': "five",
		'6': "six", '7': "seven", '8': "eight", '9': "nine"}
	// A few colour labels, like a designer marking their progress.
	colors := map[rune]string{'A': "green", 'B': "green", 'C': "green", 'R': "blue", 'S': "orange", 'Q': "purple",
		'g': "yellow", 'Ж': "red", 'Ф': "blue", 'Щ': "purple", '&': "orange", '@': "green"}
	for _, r := range chars {
		gi, err := f.GlyphIndex(&buf, r)
		if err != nil || gi == 0 {
			continue
		}
		adv, _ := f.GlyphAdvance(&buf, gi, fixed.I(upm), font.HintingNone)
		name := names[r]
		if name == "" {
			if r < 128 {
				name = string(r)
			} else {
				name = fmt.Sprintf("uni%04X", r)
			}
		}
		p.Glyphs = append(p.Glyphs, project.Glyph{
			Name: name, Unicode: int(r), Advance: math.Round(float64(adv) / 64),
			Color: colors[r], Contours: glyphContours(f, &buf, gi),
		})
	}
	// Kerning groups: every glyph gets a group named after its letter, and
	// Cyrillic letters that look like Latin ones share the Latin group, so
	// one rule such as @A @V also kerns "АV", "ТА" and so on.
	sameShape := map[rune]string{'А': "A", 'В': "B", 'С': "C", 'Е': "E", 'Ё': "E", 'Н': "H", 'К': "K", 'М': "M",
		'О': "O", 'Р': "P", 'Т': "T", 'Х': "X", 'а': "a", 'е': "e", 'ё': "e", 'о': "o", 'р': "p", 'с': "c", 'х': "x", 'у': "y"}
	for i, g := range p.Glyphs {
		r := rune(g.Unicode)
		name := g.Name
		if n, ok := sameShape[r]; ok {
			name = n
		}
		if r > ' ' {
			p.Glyphs[i].KernLeft, p.Glyphs[i].KernRight = name, name
		}
	}
	p.Kerning = map[string]map[string]float64{
		"@A": {"@V": -70, "@T": -60, "@Y": -70, "@W": -45},
		"@V": {"@A": -70, "@a": -40, "@o": -40},
		"@T": {"@A": -60, "@a": -60, "@o": -60, "@e": -60},
		"@L": {"@T": -70, "@Y": -70, "@V": -60},
		"@Y": {"@A": -70, "@o": -60},
		"@W": {"@A": -45},
		"@P": {"@A": -50},
		"T":  {"@o": -70}, // an exception: the Latin T comes closer to "o"
	}
	if err := p.Validate(); err != nil {
		log.Fatal(err)
	}
	data, err := json.Marshal(p)
	if err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile("examples/demo.sp", data, 0o644); err != nil {
		log.Fatal(err)
	}
	log.Printf("examples/demo.sp: %d glyphs", len(p.Glyphs))
}
