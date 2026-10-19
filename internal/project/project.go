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
	maxRules    = 2000
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
	// Kerning groups (classes). KernLeft is the group of the glyph's left
	// side, used when it is the second glyph of a pair; KernRight is the
	// group of its right side, used when it comes first. In Kerning, a key
	// "@name" means such a group.
	KernLeft  string `json:"kernLeft,omitempty"`
	KernRight string `json:"kernRight,omitempty"`
	// Compose marks a letter with a diacritic that Spline builds from its
	// parts (e.g. Й = И + ˘); the contours are kept up to date by the
	// editor. ComposeOff means the user draws the letter by hand.
	Compose    *Compose `json:"compose,omitempty"`
	ComposeOff bool     `json:"composeOff,omitempty"`
	// Image is a reference picture (scan, photo) shown under the outline
	// for tracing. It is not part of the exported font.
	Image *Image `json:"image,omitempty"`
	// Components are other glyphs drawn inside this one, moved by (X, Y):
	// À is A plus the grave. RefContours is their outline as the editor
	// last built it; the font uses Contours plus RefContours.
	Components  []Component `json:"components,omitempty"`
	RefContours []Contour   `json:"refContours,omitempty"`
	// Anchors place marks and join handwriting: "top"/"bottom" on letters,
	// "_top"/"_bottom" on marks, "entry"/"exit" for cursive joins.
	Anchors []Anchor `json:"anchors,omitempty"`
}

// Anchor is a named point of a glyph.
type Anchor struct {
	Name string  `json:"name"`
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
}

// Component places another glyph inside a glyph.
type Component struct {
	Glyph string  `json:"glyph"`
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
}

// Outline is everything the glyph draws: its own contours and those of
// its components.
func (g *Glyph) Outline() []Contour {
	if len(g.RefContours) == 0 {
		return g.Contours
	}
	out := make([]Contour, 0, len(g.Contours)+len(g.RefContours))
	return append(append(out, g.Contours...), g.RefContours...)
}

// Compose lists the glyphs a composed letter is made of.
type Compose struct {
	Base  string   `json:"base"`
	Marks []string `json:"marks"`
}

// Image is a picture placed in glyph coordinates: (X, Y) is its bottom
// left corner, W and H its size in font units.
type Image struct {
	Data    string  `json:"data"` // data: URL (PNG or JPEG)
	X       float64 `json:"x"`
	Y       float64 `json:"y"`
	W       float64 `json:"w"`
	H       float64 `json:"h"`
	Opacity float64 `json:"opacity,omitempty"`
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
	// Kerning maps first -> second -> adjustment in font units (negative
	// moves the pair closer). Keys are glyph names or "@group" (the first
	// key refers to KernRight groups, the second to KernLeft groups). The
	// most specific entry wins: glyph+glyph, glyph+group, group+glyph,
	// group+group.
	Kerning map[string]map[string]float64 `json:"kerning,omitempty"`
	// Contextual alternates ('calt'): a glyph changes its shape depending on
	// its neighbours, e.g. a connecting stroke in handwriting.
	Contextual []Alternate `json:"contextual,omitempty"`
	// Ligatures ('liga'): a sequence of glyphs drawn as one glyph.
	Ligatures []Ligature `json:"ligatures,omitempty"`
}

// Alternate replaces Glyph with Use when the glyph before it is one of
// Prev and the glyph after it is one of Next. An empty list means "any".
// Rules with both lists empty are kept in the file but do nothing.
type Alternate struct {
	Glyph string   `json:"glyph"`
	Use   string   `json:"use"`
	Prev  []string `json:"prev,omitempty"`
	Next  []string `json:"next,omitempty"`
}

// Ligature replaces the sequence Glyphs (two or more) with Use.
type Ligature struct {
	Glyphs []string `json:"glyphs"`
	Use    string   `json:"use"`
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

	for left, rights := range p.Kerning {
		for right, v := range rights {
			if !finite(v) || math.Abs(v) > 5000 {
				return fmt.Errorf("invalid kerning value for %q %q", left, right)
			}
		}
	}
	if len(p.Contextual) > maxRules || len(p.Ligatures) > maxRules {
		return errors.New("too many substitution rules")
	}
	for _, a := range p.Contextual {
		// A rule without context is allowed (the user is still filling it
		// in); the font builder skips it.
		if a.Glyph == "" || a.Use == "" || len(a.Prev) > maxGlyphs || len(a.Next) > maxGlyphs {
			return errors.New("invalid contextual alternate")
		}
	}
	for _, l := range p.Ligatures {
		if l.Use == "" || len(l.Glyphs) < 2 || len(l.Glyphs) > 16 {
			return errors.New("invalid ligature")
		}
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
		if im := g.Image; im != nil && (!strings.HasPrefix(im.Data, "data:image/") || !okCoord(im.X) || !okCoord(im.Y) || !okCoord(im.W) || !okCoord(im.H)) {
			g.Image = nil // a broken picture is dropped, not an error
		}
		if len(g.Contours) > maxContours {
			return fmt.Errorf("glyph %q has too many contours", g.Name)
		}
		if len(g.Anchors) > 64 {
			return fmt.Errorf("glyph %q has too many anchors", g.Name)
		}
		for _, a := range g.Anchors {
			if a.Name == "" || len(a.Name) > 32 || !okCoord(a.X) || !okCoord(a.Y) {
				return fmt.Errorf("glyph %q has an invalid anchor", g.Name)
			}
		}
		if len(g.RefContours) > maxContours {
			return fmt.Errorf("glyph %q has too many component contours", g.Name)
		}
		for _, c := range g.Outline() {
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
