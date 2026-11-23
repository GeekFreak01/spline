package fontgen

import (
	"fmt"
	"testing"

	"golang.org/x/image/font"
	"golang.org/x/image/font/sfnt"
	"golang.org/x/image/math/fixed"

	"github.com/GeekFreak01/spline/internal/project"
)

// Big groups go out as classes, and every pair still kerns as the project
// says: group+group, glyph exceptions, zero exceptions and pairs outside
// the groups.
func TestClassKerning(t *testing.T) {
	p := testProject()
	h := p.Glyphs[1].Contours
	var names []string
	add := func(i int, left, right string) {
		n := fmt.Sprintf("g%02d", i)
		names = append(names, n)
		p.Glyphs = append(p.Glyphs, project.Glyph{Name: n, Unicode: 0x4E00 + i, Advance: 600, Contours: h, KernLeft: left, KernRight: right})
	}
	for i := 0; i < 40; i++ {
		switch {
		case i < 15:
			add(i, "L1", "R1")
		case i < 30:
			add(i, "L2", "R2")
		default:
			add(i, "", "") // no groups
		}
	}
	p.Kerning = map[string]map[string]float64{
		"@R1": {"@L1": -50, "@L2": -20},
		"@R2": {"@L1": 30, "g20": -5},             // group+glyph
		"g00": {"g01": 0, "@L2": -90, "g35": -15}, // zero exception, glyph+group, plain pair
	}
	fd := prepare(p, TTF)
	if fd.kernClasses == nil {
		t.Fatal("big groups were not written as classes")
	}
	data, err := Build(p, TTF)
	if err != nil {
		t.Fatal(err)
	}
	fnt, err := sfnt.Parse(data)
	if err != nil {
		t.Fatal(err)
	}
	want := map[[2]int]int{}
	for _, kp := range fd.kern {
		want[[2]int{kp.left, kp.right}] = int(kp.value)
	}
	var buf sfnt.Buffer
	for _, a := range names {
		for _, b := range names {
			ia, ib := fd.gid[a], fd.gid[b]
			k, err := fnt.Kern(&buf, sfnt.GlyphIndex(ia), sfnt.GlyphIndex(ib), fixed.I(1000), font.HintingNone)
			if err != nil && err != sfnt.ErrNotFound {
				t.Fatal(err)
			}
			if got := k.Round(); got != want[[2]int{ia, ib}] {
				t.Errorf("kern %s %s = %d, want %d", a, b, got, want[[2]int{ia, ib}])
			}
		}
	}
	plain, err := pairLookup(fd.kern)
	if err != nil {
		t.Fatal(err)
	}
	subs, err := pairSubtables(fd.kernClasses.exceptions)
	if err != nil {
		t.Fatal(err)
	}
	if classes := pairLookupOf(append(subs, fd.kernClasses.sub)); len(classes) >= len(plain) {
		t.Errorf("classes take %d bytes, plain pairs %d", len(classes), len(plain))
	}
}
