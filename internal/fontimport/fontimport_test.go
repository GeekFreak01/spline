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
