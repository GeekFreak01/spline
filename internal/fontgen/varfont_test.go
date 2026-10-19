package fontgen

import (
	"os"
	"testing"

	"github.com/GeekFreak01/spline/internal/project"
)

// A Bold master that is the default stretched by 20% (so every glyph is
// compatible) and a Light one at 300 that is 10% narrower.
func varProject(t *testing.T) *project.Project {
	data, err := os.ReadFile("../../examples/demo.sp")
	if err != nil {
		t.Skip("no demo project")
	}
	p, err := project.Parse(data)
	if err != nil {
		t.Fatal(err)
	}
	scale := func(cs []project.Contour, k float64) []project.Contour {
		out := make([]project.Contour, len(cs))
		for i, c := range cs {
			nc := project.Contour{Closed: c.Closed, Nodes: make([]project.Node, len(c.Nodes))}
			for j, n := range c.Nodes {
				m := n
				m.X *= k
				if n.In != nil {
					m.In = &project.Point{X: n.In.X * k, Y: n.In.Y}
				}
				if n.Out != nil {
					m.Out = &project.Point{X: n.Out.X * k, Y: n.Out.Y}
				}
				nc.Nodes[j] = m
			}
			out[i] = nc
		}
		return out
	}
	p.Axis = &project.Axis{Tag: "wght", Min: 300, Max: 700}
	p.Masters = []project.Master{{ID: "m0", Name: "Regular", Loc: 400}, {ID: "m1", Name: "Bold", Loc: 700}, {ID: "m2", Name: "Light", Loc: 300}}
	for i := range p.Glyphs {
		g := &p.Glyphs[i]
		g.Layers = map[string]project.Layer{
			"m1": {Contours: scale(g.Contours, 1.2), Advance: g.Advance * 1.2},
			"m2": {Contours: scale(g.Contours, 0.9), Advance: g.Advance * 0.9},
		}
	}
	return p
}

func TestVariableFont(t *testing.T) {
	data, err := Build(varProject(t), VarTTF)
	if err != nil {
		t.Fatal(err)
	}
	if out := os.Getenv("SPLINE_FONT_OUT"); out != "" {
		os.WriteFile(out, data, 0o644)
	}
}

// Three masters on one side: Regular 400, Medium 550 (+5%), Bold 700 (+20%).
func TestVariableFontIntermediate(t *testing.T) {
	p := varProject(t)
	p.Masters = []project.Master{{ID: "m0", Name: "Regular", Loc: 400}, {ID: "m2", Name: "Medium", Loc: 550}, {ID: "m1", Name: "Bold", Loc: 700}}
	p.Axis = &project.Axis{Tag: "wght", Min: 400, Max: 700}
	for i := range p.Glyphs {
		g := &p.Glyphs[i]
		l := g.Layers["m2"]
		l.Advance = g.Advance * 1.05
		g.Layers["m2"] = l
	}
	data, err := Build(p, VarTTF)
	if err != nil {
		t.Fatal(err)
	}
	if out := os.Getenv("SPLINE_FONT_OUT"); out != "" {
		os.WriteFile(out+".3.ttf", data, 0o644)
	}
}

// Two axes: Regular, Bold (wght 700), Condensed (wdth 75) and Bold
// Condensed in the corner, drawn on purpose not as the sum of the others.
func TestVariableFontTwoAxes(t *testing.T) {
	p := varProject(t)
	p.Axis = &project.Axis{Tag: "wght", Min: 400, Max: 700}
	p.Axis2 = &project.Axis{Tag: "wdth", Min: 75, Max: 100}
	p.Masters = []project.Master{
		{ID: "m0", Name: "Regular", Loc: 400, Loc2: 100},
		{ID: "m1", Name: "Bold", Loc: 700, Loc2: 100},
		{ID: "m2", Name: "Condensed", Loc: 400, Loc2: 75},
		{ID: "m3", Name: "Bold Condensed", Loc: 700, Loc2: 75},
	}
	for i := range p.Glyphs {
		g := &p.Glyphs[i]
		l := g.Layers["m1"]
		g.Layers["m3"] = project.Layer{Contours: l.Contours, Advance: g.Advance * 0.95}
	}
	data, err := Build(p, VarTTF)
	if err != nil {
		t.Fatal(err)
	}
	if out := os.Getenv("SPLINE_FONT_OUT"); out != "" {
		os.WriteFile(out+".2d.ttf", data, 0o644)
	}
}
