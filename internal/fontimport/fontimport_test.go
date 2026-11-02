package fontimport

import (
	"testing"

	"golang.org/x/image/font/gofont/goregular"

	"github.com/GeekFreak01/spline/internal/fontgen"
)

func TestImportRoundTrip(t *testing.T) {
	res, err := Import(goregular.TTF)
	if err != nil {
		t.Fatal(err)
	}
	p := res.Project
	if p.Info.FamilyName != "Go" || p.Info.UnitsPerEm != 2048 {
		t.Errorf("info = %+v", p.Info)
	}
	var a *int
	for i, g := range p.Glyphs {
		if g.Unicode == 'A' {
			a = &i
			if len(g.Contours) != 2 || g.Advance <= 0 {
				t.Errorf("A: %d contours, advance %v", len(g.Contours), g.Advance)
			}
		}
	}
	if a == nil {
		t.Fatal("no A")
	}
	if _, err := fontgen.Build(p, fontgen.TTF); err != nil {
		t.Fatalf("re-export: %v", err)
	}
	if _, err := Import([]byte("not a font")); err == nil {
		t.Error("garbage accepted")
	}
}

// Kerning of glyphs far down the code table (Cyrillic, in many fonts) is kept.
func TestImportKerningOfLastGlyphs(t *testing.T) {
	res, err := Import(goregular.TTF)
	if err != nil {
		t.Fatal(err)
	}
	p := res.Project
	var encoded []string
	for _, g := range p.Glyphs {
		if g.Unicode > 0x20 && len(g.Contours) > 0 {
			encoded = append(encoded, g.Name)
		}
	}
	if len(encoded) <= 500 {
		t.Skipf("only %d glyphs", len(encoded))
	}
	l, r := encoded[len(encoded)-2], encoded[len(encoded)-1]
	p.Kerning = map[string]map[string]float64{l: {r: -123}}
	data, err := fontgen.Build(p, fontgen.TTF)
	if err != nil {
		t.Fatal(err)
	}
	back, err := Import(data)
	if err != nil {
		t.Fatal(err)
	}
	if got := back.Project.Kerning[l][r]; got != -123 {
		t.Errorf("kerning of %s %s = %v", l, r, got)
	}
}
