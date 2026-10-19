package fontgen

import (
	"bytes"
	"os"
	"testing"

	"github.com/GeekFreak01/spline/internal/project"
)

// anchorProject: н with "top", a combining breve with "_top" and a script
// letter with entry/exit.
func anchorProject() *project.Project {
	p := testProject()
	rect := func(x0, y0, x1, y1 float64) project.Contour {
		return project.Contour{Closed: true, Nodes: []project.Node{{X: x0, Y: y0}, {X: x1, Y: y0}, {X: x1, Y: y1}, {X: x0, Y: y1}}}
	}
	p.Glyphs = append(p.Glyphs,
		project.Glyph{Name: "en", Unicode: 'н', Advance: 500, Contours: []project.Contour{rect(50, 0, 450, 500)},
			Anchors: []project.Anchor{{Name: "top", X: 250, Y: 500}, {Name: "entry", X: 50, Y: 100}, {Name: "exit", X: 450, Y: 300}}},
		project.Glyph{Name: "brevecomb", Unicode: 0x306, Advance: 0, Contours: []project.Contour{rect(-80, 600, 80, 680)},
			Anchors: []project.Anchor{{Name: "_top", X: 0, Y: 570}}},
	)
	p.Kerning = map[string]map[string]float64{"H": {"O": -50}, "en": {"en": -20}}
	return p
}

func TestMarkAndCursiveBuild(t *testing.T) {
	for _, f := range []Format{TTF, OTF} {
		data, err := Build(anchorProject(), f)
		if err != nil {
			t.Fatal(err)
		}
		for _, tag := range []string{"GPOS", "GDEF"} {
			if !bytes.Contains(data[:400], []byte(tag)) {
				t.Errorf("%v: no %s table", f, tag)
			}
		}
		if out := os.Getenv("SPLINE_FONT_OUT"); out != "" && f == TTF {
			os.WriteFile(out, data, 0o644)
		}
	}
}

