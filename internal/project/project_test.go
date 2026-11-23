package project

import (
	"fmt"
	"strings"
	"testing"
)

func base() *Project {
	p := &Project{Format: FormatName, Version: CurrentVersion}
	p.Info.FamilyName = "T"
	p.Info.StyleName = "Regular"
	p.Info.UnitsPerEm = 1000
	p.Info.Ascender = 800
	p.Info.Descender = -200
	return p
}

// One group pair over thousands of glyphs multiplies out: it must be
// refused before the font builder tries it.
func TestKerningGroupsLimit(t *testing.T) {
	p := base()
	for i := 0; i < 3000; i++ {
		p.Glyphs = append(p.Glyphs, Glyph{Name: fmt.Sprintf("g%d", i), Advance: 500, KernLeft: "B", KernRight: "A"})
	}
	p.Kerning = map[string]map[string]float64{"@A": {"@B": 10}}
	if err := p.Validate(); err == nil || !strings.Contains(err.Error(), "kerning") {
		t.Fatalf("want a kerning error, got %v", err)
	}
	p.Kerning = map[string]map[string]float64{"g1": {"@B": 10}}
	if err := p.Validate(); err != nil {
		t.Fatalf("one glyph against a group is fine: %v", err)
	}
}

func TestMastersLimit(t *testing.T) {
	p := base()
	p.Glyphs = []Glyph{{Name: "a", Advance: 500}}
	for i := 0; i <= maxMasters; i++ {
		p.Masters = append(p.Masters, Master{ID: fmt.Sprintf("m%d", i), Name: fmt.Sprintf("M%d", i), Loc: float64(100 + i)})
	}
	if err := p.Validate(); err == nil || !strings.Contains(err.Error(), "masters") {
		t.Fatalf("want a masters error, got %v", err)
	}
}
