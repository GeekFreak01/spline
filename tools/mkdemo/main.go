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
	"strings"

	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/goregular"
	"golang.org/x/image/font/sfnt"
	"golang.org/x/image/math/fixed"

	"github.com/GeekFreak01/spline/internal/fontimport"
	"github.com/GeekFreak01/spline/internal/project"
)

const upm = 1000

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
		"0123456789 .,:;!?-–—'\"«»()[]/&@#%*+=_<>€$№" +
		"¨˘`´ˆ˜" + "ÀÁÂÄÉÈÊËÑÖÜàáâäéèêëñöü"
	names := map[rune]string{' ': "space", '.': "period", ',': "comma", ':': "colon", ';': "semicolon", '!': "exclam",
		'?': "question", '-': "hyphen", '–': "endash", '—': "emdash", '\'': "quotesingle", '"': "quotedbl",
		'«': "guillemetleft", '»': "guillemetright", '(': "parenleft", ')': "parenright", '[': "bracketleft",
		']': "bracketright", '/': "slash", '&': "ampersand", '@': "at", '#': "numbersign", '%': "percent",
		'*': "asterisk", '+': "plus", '=': "equal", '_': "underscore", '<': "less", '>': "greater", '€': "Euro",
		'$': "dollar", '№': "numero", '0': "zero", '1': "one", '2': "two", '3': "three", '4': "four", '5': "five",
		'6': "six", '7': "seven", '8': "eight", '9': "nine",
		'¨': "dieresis", '˘': "breve", '`': "grave", '´': "acute", 'ˆ': "circumflex", '˜': "tilde"}
	// Letters with diacritics are left empty: Spline builds them from the
	// base letter and the mark when the project is opened.
	composed := "ЁЙёйÀÁÂÄÉÈÊËÑÖÜàáâäéèêëñöü"
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
		contours := fontimport.Contours(f, &buf, gi, upm)
		if strings.ContainsRune(composed, r) {
			contours = []project.Contour{}
		}
		p.Glyphs = append(p.Glyphs, project.Glyph{
			Name: name, Unicode: int(r), Advance: math.Round(float64(adv) / 64),
			Color: colors[r], Contours: contours,
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
