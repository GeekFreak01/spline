package fontgen

import (
	"bytes"
	"os"
	"testing"

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
	if out := os.Getenv("SPLINE_FONT_OUT"); out != "" {
		os.WriteFile(out, ttf, 0o644)
		os.WriteFile(out+".woff", woff, 0o644)
	}
}
