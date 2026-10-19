package ufo

import (
	"math"
	"os"
	"testing"

	"github.com/GeekFreak01/spline/internal/project"
)

func demo(t *testing.T) *project.Project {
	data, err := os.ReadFile("../../examples/demo.sp")
	if err != nil {
		t.Skip("no demo project")
	}
	p, err := project.Parse(data)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

// Export, import again: the same glyphs, points, kerning and groups.
func TestRoundTrip(t *testing.T) {
	p := demo(t)
	p.Info.Overshoot = 12
	data, ext, err := Export(p)
	if err != nil {
		t.Fatal(err)
	}
	if ext != "ufoz" {
		t.Errorf("ext %q", ext)
	}
	if out := os.Getenv("SPLINE_UFO_OUT"); out != "" {
		os.WriteFile(out+"."+ext, data, 0o644)
	}
	q, skipped, err := Import(data)
	if err != nil {
		t.Fatal(err)
	}
	if skipped != 0 || len(q.Glyphs) != len(p.Glyphs) {
		t.Fatalf("glyphs %d (skipped %d), want %d", len(q.Glyphs), skipped, len(p.Glyphs))
	}
	if q.Info.FamilyName != p.Info.FamilyName || q.Info.Overshoot != 12 || q.Info.CapHeight != p.Info.CapHeight {
		t.Errorf("info %+v", q.Info)
	}
	near := func(a, b float64) bool { return math.Abs(a-b) < 0.01 }
	for i, g := range p.Glyphs {
		h := q.Glyphs[i]
		if g.Name != h.Name || g.Unicode != h.Unicode || !near(g.Advance, h.Advance) || g.KernLeft != h.KernLeft || g.KernRight != h.KernRight {
			t.Fatalf("glyph %s: %+v vs %+v", g.Name, h.Name, g.Name)
		}
		if len(g.Contours) != len(h.Contours) {
			t.Fatalf("%s: %d contours, want %d", g.Name, len(h.Contours), len(g.Contours))
		}
		for ci, c := range g.Contours {
			d := h.Contours[ci]
			if len(c.Nodes) != len(d.Nodes) || c.Closed != d.Closed {
				t.Fatalf("%s contour %d: %d nodes (closed %v), want %d (%v)", g.Name, ci, len(d.Nodes), d.Closed, len(c.Nodes), c.Closed)
			}
			for ni, n := range c.Nodes {
				m := d.Nodes[ni]
				if !near(n.X, m.X) || !near(n.Y, m.Y) || (n.In == nil) != (m.In == nil) || (n.Out == nil) != (m.Out == nil) {
					t.Fatalf("%s %d:%d: %+v vs %+v", g.Name, ci, ni, m, n)
				}
				if n.In != nil && (!near(n.In.X, m.In.X) || !near(n.In.Y, m.In.Y)) {
					t.Fatalf("%s %d:%d in handle", g.Name, ci, ni)
				}
			}
		}
	}
	for a, row := range p.Kerning {
		for b, v := range row {
			if math.Round(v) != q.Kerning[a][b] {
				t.Errorf("kerning %s %s = %v, want %v", a, b, q.Kerning[a][b], v)
			}
		}
	}
}

// Masters go out as a designspace with a UFO each, and come back.
func TestDesignspace(t *testing.T) {
	p := demo(t)
	p.Axis = &project.Axis{Tag: "wght", Min: 400, Max: 700}
	p.Masters = []project.Master{{ID: "m0", Name: "Regular", Loc: 400}, {ID: "m1", Name: "Bold", Loc: 700, Kerning: map[string]map[string]float64{"A": {"V": -120}}}}
	for i := range p.Glyphs {
		g := &p.Glyphs[i]
		l := project.Layer{Advance: g.Advance + 40}
		for _, c := range g.Contours {
			nc := project.Contour{Closed: c.Closed}
			for _, n := range c.Nodes {
				n.X += 20
				if n.In != nil {
					n.In = &project.Point{X: n.In.X + 20, Y: n.In.Y}
				}
				if n.Out != nil {
					n.Out = &project.Point{X: n.Out.X + 20, Y: n.Out.Y}
				}
				nc.Nodes = append(nc.Nodes, n)
			}
			l.Contours = append(l.Contours, nc)
		}
		g.Layers = map[string]project.Layer{"m1": l}
	}
	data, ext, err := Export(p)
	if err != nil {
		t.Fatal(err)
	}
	if ext != "zip" {
		t.Errorf("ext %q", ext)
	}
	if out := os.Getenv("SPLINE_UFO_OUT"); out != "" {
		os.WriteFile(out+"-masters."+ext, data, 0o644)
	}
	q, _, err := Import(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(q.Masters) != 2 || q.Masters[0].Name != "Regular" || q.Masters[1].Loc != 700 || q.Axis == nil || q.Axis.Tag != "wght" {
		t.Fatalf("masters %+v axis %+v", q.Masters, q.Axis)
	}
	if q.Masters[1].Kerning["A"]["V"] != -120 {
		t.Errorf("bold kerning %v", q.Masters[1].Kerning)
	}
	for _, g := range q.Glyphs {
		if len(g.Contours) == 0 {
			continue
		}
		l, ok := g.Layers["m1"]
		if !ok || math.Abs(l.Contours[0].Nodes[0].X-g.Contours[0].Nodes[0].X-20) > 0.01 {
			t.Fatalf("%s: bold layer %v", g.Name, ok)
		}
	}
}
