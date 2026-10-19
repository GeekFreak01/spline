package fontgen

import (
	"os"
	"testing"

	"golang.org/x/image/font"
	"golang.org/x/image/font/sfnt"
	"golang.org/x/image/math/fixed"

	"github.com/GeekFreak01/spline/internal/project"
)

func testProject() *project.Project {
	rect := func(x0, y0, x1, y1 float64) project.Contour {
		return project.Contour{Closed: true, Nodes: []project.Node{
			{X: x0, Y: y0}, {X: x0, Y: y1}, {X: x1, Y: y1}, {X: x1, Y: y0}, // clockwise on purpose
		}}
	}
	circle := project.Contour{Closed: true, Nodes: []project.Node{
		{X: 300, Y: 0, In: &project.Point{X: 135, Y: 0}, Out: &project.Point{X: 465, Y: 0}, Smooth: true},
		{X: 600, Y: 350, In: &project.Point{X: 600, Y: 157}, Out: &project.Point{X: 600, Y: 543}, Smooth: true},
		{X: 300, Y: 700, In: &project.Point{X: 465, Y: 700}, Out: &project.Point{X: 135, Y: 700}, Smooth: true},
		{X: 0, Y: 350, In: &project.Point{X: 0, Y: 543}, Out: &project.Point{X: 0, Y: 157}, Smooth: true},
	}}
	return &project.Project{
		Format: "spline", Version: 1,
		Info: project.Info{FamilyName: "Тестовый шрифт", StyleName: "Regular"},
		Glyphs: []project.Glyph{
			{Name: "space", Unicode: ' ', Advance: 250},
			{Name: "H", Unicode: 'H', Advance: 600, Contours: []project.Contour{
				rect(50, 0, 150, 700), rect(450, 0, 550, 700), rect(100, 300, 500, 400),
			}},
			{Name: "O", Unicode: 'O', Advance: 640, Contours: []project.Contour{circle, rect(200, 200, 400, 500)}},
			{Name: "Ж", Unicode: 'Ж', Advance: 700, Contours: []project.Contour{rect(0, 0, 700, 700)}},
			{Name: "empty", Unicode: 'Q', Advance: 500},
			{Name: "smile", Unicode: 0x1F600, Advance: 900, Contours: []project.Contour{rect(0, 0, 900, 900)}},
		},
	}
}

func TestBuildParses(t *testing.T) {
	for _, f := range []Format{TTF, OTF} {
		data, err := Build(testProject(), f)
		if err != nil {
			t.Fatalf("format %d: %v", f, err)
		}
		fnt, err := sfnt.Parse(data)
		if err != nil {
			t.Fatalf("format %d: parse: %v", f, err)
		}
		if n := fnt.NumGlyphs(); n != 6 {
			t.Fatalf("format %d: got %d glyphs, want 6", f, n)
		}
		var buf sfnt.Buffer
		name, err := fnt.Name(&buf, sfnt.NameIDFamily)
		if err != nil || name != "Тестовый шрифт" {
			t.Fatalf("format %d: family %q, %v", f, name, err)
		}
		for _, r := range []rune{'H', 'O', 'Ж', 0x1F600} {
			gi, err := fnt.GlyphIndex(&buf, r)
			if err != nil || gi == 0 {
				t.Fatalf("format %d: no glyph for %q: %v", f, r, err)
			}
		}
		gi, _ := fnt.GlyphIndex(&buf, 'O')
		segs, err := fnt.LoadGlyph(&buf, gi, fixed.I(1000), nil)
		if err != nil || len(segs) == 0 {
			t.Fatalf("format %d: load O: %v", f, err)
		}
		adv, err := fnt.GlyphAdvance(&buf, gi, fixed.I(1000), font.HintingNone)
		if err != nil || adv.Round() != 640 {
			t.Fatalf("format %d: advance %v, %v", f, adv, err)
		}
	}
}

func TestNormalizeHoles(t *testing.T) {
	p := testProject()
	cs := normalize(p.Glyphs[2].Contours, true)
	if signedArea(flatten(cs[0])) <= 0 {
		t.Error("outer contour should be counter-clockwise")
	}
	if signedArea(flatten(cs[1])) >= 0 {
		t.Error("hole should be clockwise")
	}
	// Overlapping bars of H must all keep the same direction.
	for i, c := range normalize(p.Glyphs[1].Contours, true) {
		if signedArea(flatten(c)) <= 0 {
			t.Errorf("H contour %d should be counter-clockwise", i)
		}
	}
}

func TestCubicToQuads(t *testing.T) {
	s := segment{p0: vec{0, 0}, c1: vec{0, 500}, c2: vec{1000, 500}, p3: vec{1000, 0}}
	qs := cubicToQuads(s, 0.5)
	if len(qs) < 2 {
		t.Fatalf("expected several quads, got %d", len(qs))
	}
	if qs[0].p0 != s.p0 || qs[len(qs)-1].p2 != s.p3 {
		t.Fatal("quads must start and end on the cubic end points")
	}
}

func TestExampleFile(t *testing.T) {
	data, err := os.ReadFile("../../examples/hello.sp")
	if err != nil {
		t.Fatal(err)
	}
	p, err := project.Parse(data)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range []Format{TTF, OTF} {
		font, err := Build(p, f)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := sfnt.Parse(font); err != nil {
			t.Fatalf("format %d: %v", f, err)
		}
	}
}

func TestKerning(t *testing.T) {
	p := testProject()
	p.Glyphs = append(p.Glyphs, project.Glyph{Name: "V", Unicode: 'V', Advance: 600, Contours: p.Glyphs[1].Contours})
	p.Kerning = map[string]map[string]float64{
		"H": {"V": -80, "O": 25, "missing": -10},
		"V": {"H": -40},
	}
	for _, f := range []Format{TTF, OTF} {
		data, err := Build(p, f)
		if err != nil {
			t.Fatal(err)
		}
		fnt, err := sfnt.Parse(data)
		if err != nil {
			t.Fatalf("format %d: %v", f, err)
		}
		var buf sfnt.Buffer
		gi := func(r rune) sfnt.GlyphIndex { g, _ := fnt.GlyphIndex(&buf, r); return g }
		for _, c := range []struct {
			a, b rune
			want int
		}{{'H', 'V', -80}, {'H', 'O', 25}, {'V', 'H', -40}, {'O', 'H', 0}} {
			k, err := fnt.Kern(&buf, gi(c.a), gi(c.b), fixed.I(1000), font.HintingNone)
			if err != nil && c.want != 0 {
				t.Fatalf("format %d: kern %c%c: %v", f, c.a, c.b, err)
			}
			if k.Round() != c.want {
				t.Errorf("format %d: kern %c%c = %d, want %d", f, c.a, c.b, k.Round(), c.want)
			}
		}
	}
}

func TestKerningGroups(t *testing.T) {
	p := testProject()
	h := p.Glyphs[1].Contours
	add := func(name string, r rune, left, right string) {
		p.Glyphs = append(p.Glyphs, project.Glyph{Name: name, Unicode: int(r), Advance: 600, Contours: h, KernLeft: left, KernRight: right})
	}
	add("A", 'A', "A", "A")
	add("Acyr", 'А', "A", "A") // Cyrillic A shares the Latin A groups
	add("V", 'V', "V", "V")
	add("W", 'W', "V", "V")
	p.Kerning = map[string]map[string]float64{
		"@A": {"@V": -70},         // group + group
		"A":  {"W": 0, "@V": -60}, // glyph exceptions: A+W cancelled, A+V group -60
		"@V": {"A": -30},          // group + glyph
	}
	data, err := Build(p, TTF)
	if err != nil {
		t.Fatal(err)
	}
	fnt, err := sfnt.Parse(data)
	if err != nil {
		t.Fatal(err)
	}
	var buf sfnt.Buffer
	gi := func(r rune) sfnt.GlyphIndex { g, _ := fnt.GlyphIndex(&buf, r); return g }
	for _, c := range []struct {
		a, b rune
		want int
	}{
		{'А', 'V', -70}, // Cyrillic A via groups
		{'А', 'W', -70},
		{'A', 'V', -60}, // glyph+group beats group+group
		{'A', 'W', 0},   // zero exception cancels the group value
		{'W', 'A', -30}, // group+glyph
		{'V', 'А', 0},   // no rule for the Cyrillic A on the right
	} {
		k, _ := fnt.Kern(&buf, gi(c.a), gi(c.b), fixed.I(1000), font.HintingNone)
		if k.Round() != c.want {
			t.Errorf("kern %c%c = %d, want %d", c.a, c.b, k.Round(), c.want)
		}
	}
}

func TestPSNameCyrillic(t *testing.T) {
	for in, want := range map[string]string{
		"Мой Шрифт": "MoyShrift",
		"Ёлка":      "Yolka",
		"Café":      "Cafe",
		"日本":        "SplineFont",
	} {
		if got := psName(in); got != want {
			t.Errorf("psName(%q) = %q, want %q", in, got, want)
		}
	}
}
