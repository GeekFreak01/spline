// Package project describes the .sp file format used by Spline.
//
// A .sp file is plain UTF-8 JSON, so it can be shared, versioned in git
// and opened on any computer. Coordinates are in font units with the
// y axis pointing up and the baseline at y = 0.
package project

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
)

// FormatName is the value of the "format" field in every .sp file.
const FormatName = "spline"

// CurrentVersion is the newest file format version this build understands.
const CurrentVersion = 1

const (
	maxGlyphs   = 10000
	maxContours = 2000
	maxNodes    = 20000
	maxCoord    = 30000
)

// Point is a position in font units.
type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// Node is an on-curve point with optional Bézier handles.
// In and Out are absolute positions of the incoming/outgoing handles.
// A segment between two nodes is a straight line when both the Out handle
// of the first node and the In handle of the second node are absent.
type Node struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	In     *Point  `json:"in,omitempty"`
	Out    *Point  `json:"out,omitempty"`
	Smooth bool    `json:"smooth,omitempty"`
}

// Contour is a closed outline. Fonts only support closed outlines, so an
// unfinished contour is closed automatically on export.
type Contour struct {
	Nodes  []Node `json:"nodes"`
	Closed bool   `json:"closed"`
}

// Glyph is one character of the font.
type Glyph struct {
	Name     string    `json:"name"`
	Unicode  int       `json:"unicode,omitempty"`
	Advance  float64   `json:"advance"`
	Color    string    `json:"color,omitempty"`
	Contours []Contour `json:"contours"`
}

// Info holds font-wide settings.
type Info struct {
	FamilyName string `json:"familyName"`
	StyleName  string `json:"styleName"`
	Designer   string `json:"designer,omitempty"`
	Version    string `json:"version,omitempty"`
	UnitsPerEm int    `json:"unitsPerEm"`
	Ascender   int    `json:"ascender"`
	Descender  int    `json:"descender"`
	XHeight    int    `json:"xHeight"`
	CapHeight  int    `json:"capHeight"`
}

// Guide is a ruler guide shared by all glyphs: a horizontal line at
// y = Pos (Axis "y") or a vertical line at x = Pos (Axis "x").
type Guide struct {
	Axis string  `json:"axis"`
	Pos  float64 `json:"pos"`
}

// Project is the root object of a .sp file.
type Project struct {
	Format  string  `json:"format"`
	Version int     `json:"version"`
	Info    Info    `json:"info"`
	Glyphs  []Glyph `json:"glyphs"`
	Guides  []Guide `json:"guides,omitempty"`
}

// Parse decodes and validates a .sp document.
func Parse(data []byte) (*Project, error) {
	var p Project
	if err := json.Unmarshal(data, &p); err != nil {
		return nil, fmt.Errorf("not a valid .sp file: %w", err)
	}
	if err := p.Validate(); err != nil {
		return nil, err
	}
	return &p, nil
}

// Validate checks the project, fills in defaults and rejects broken data.
func (p *Project) Validate() error {
	if p.Format != FormatName {
		return errors.New(`not a Spline project (missing "format": "spline")`)
	}
	if p.Version > CurrentVersion {
		return fmt.Errorf("file version %d is newer than this app supports (%d); please update Spline", p.Version, CurrentVersion)
	}
	in := &p.Info
	in.FamilyName = strings.TrimSpace(in.FamilyName)
	if in.FamilyName == "" {
		in.FamilyName = "My Font"
	}
	in.StyleName = strings.TrimSpace(in.StyleName)
	if in.StyleName == "" {
		in.StyleName = "Regular"
	}
	if in.Version == "" {
		in.Version = "1.000"
	}
	if in.UnitsPerEm < 16 || in.UnitsPerEm > 16384 {
		in.UnitsPerEm = 1000
	}
	if in.Ascender <= 0 {
		in.Ascender = 800
	}
	if in.Descender >= 0 {
		in.Descender = -200
	}
	if in.XHeight <= 0 {
		in.XHeight = 500
	}
	if in.CapHeight <= 0 {
		in.CapHeight = 700
	}

	for _, g := range p.Guides {
		if (g.Axis != "x" && g.Axis != "y") || !okCoord(g.Pos) {
			return errors.New("invalid guide")
		}
	}
	if len(p.Glyphs) > maxGlyphs {
		return fmt.Errorf("too many glyphs (%d, max %d)", len(p.Glyphs), maxGlyphs)
	}
	seenUni := map[int]string{}
	seenName := map[string]bool{}
	nodes := 0
	for i := range p.Glyphs {
		g := &p.Glyphs[i]
		if g.Name == "" {
			return fmt.Errorf("glyph #%d has no name", i+1)
		}
		if seenName[g.Name] {
			return fmt.Errorf("duplicate glyph name %q", g.Name)
		}
		seenName[g.Name] = true
		if g.Unicode < 0 || g.Unicode > 0x10FFFF {
			return fmt.Errorf("glyph %q has invalid unicode %d", g.Name, g.Unicode)
		}
		if g.Unicode != 0 {
			if other, ok := seenUni[g.Unicode]; ok {
				return fmt.Errorf("glyphs %q and %q have the same unicode U+%04X", other, g.Name, g.Unicode)
			}
			seenUni[g.Unicode] = g.Name
		}
		if !finite(g.Advance) || g.Advance < 0 || g.Advance > maxCoord {
			return fmt.Errorf("glyph %q has invalid width", g.Name)
		}
		if len(g.Contours) > maxContours {
			return fmt.Errorf("glyph %q has too many contours", g.Name)
		}
		for _, c := range g.Contours {
			nodes += len(c.Nodes)
			for _, n := range c.Nodes {
				if !okCoord(n.X) || !okCoord(n.Y) {
					return fmt.Errorf("glyph %q has a point out of range", g.Name)
				}
				for _, h := range []*Point{n.In, n.Out} {
					if h != nil && (!okCoord(h.X) || !okCoord(h.Y)) {
						return fmt.Errorf("glyph %q has a handle out of range", g.Name)
					}
				}
			}
		}
		if nodes > maxNodes*10 {
			return errors.New("project is too large")
		}
	}
	return nil
}

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

func okCoord(v float64) bool { return finite(v) && math.Abs(v) <= maxCoord }
