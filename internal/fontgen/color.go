package fontgen

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/GeekFreak01/spline/internal/project"
)

// Colour fonts (extended mode), COLR version 0 with a CPAL palette: a
// glyph whose contours have paints is drawn as a stack of layer glyphs,
// each in one colour; apps without colour support show the plain glyph.

type colorLayer struct {
	glyph int    // id of the layer glyph
	paint uint16 // palette index, 0xFFFF = the text colour
}

// colorLayers splits the coloured glyphs of src into layer glyphs, one per
// colour. Returns the extra glyphs and, by the
// index of the coloured glyph in src, the layers (glyph ids counted from
// firstID).
func colorLayers(p *project.Project, src []project.Glyph, firstID int) ([]project.Glyph, map[int][]colorLayer) {
	if len(p.Palette) == 0 {
		return nil, nil
	}
	var extra []project.Glyph
	layers := map[int][]colorLayer{}
	for i, g := range src {
		painted := false
		for _, c := range g.Contours {
			if c.Paint > 0 && c.Paint <= len(p.Palette) {
				painted = true
				break
			}
		}
		if !painted {
			continue
		}
		// One layer per colour, in the order the colours first appear (later
		// on top), so a shape keeps its holes. Components and details are in
		// the text colour, at the bottom.
		groups := map[int][]project.Contour{}
		var order []int
		add := func(paint int, c project.Contour) {
			if _, ok := groups[paint]; !ok {
				order = append(order, paint)
			}
			groups[paint] = append(groups[paint], c)
		}
		for _, c := range g.RefContours {
			add(0, c)
		}
		for _, c := range g.Contours {
			if c.Brush != "" {
				continue
			}
			paint := c.Paint
			if paint > len(p.Palette) {
				paint = 0
			}
			add(paint, c)
		}
		for _, paint := range order {
			pi := uint16(0xFFFF)
			if paint > 0 {
				pi = uint16(paint - 1)
			}
			extra = append(extra, project.Glyph{Name: fmt.Sprintf("%s.layer%d", g.Name, len(layers[i])), Advance: g.Advance, Contours: groups[paint]})
			layers[i] = append(layers[i], colorLayer{glyph: firstID + len(extra) - 1, paint: pi})
		}
	}
	return extra, layers
}

func buildCOLR(fd *fontData) []byte {
	type base struct {
		gid    int
		layers []colorLayer
	}
	var bases []base
	for gid := range fd.glyphs {
		if l, ok := fd.colr[gid]; ok {
			bases = append(bases, base{gid, l})
		}
	}
	w := &writer{}
	w.u16(0)
	w.u16(uint16(len(bases)))
	w.u32(14)
	w.u32(uint32(14 + 6*len(bases)))
	total := 0
	for _, b := range bases {
		total += len(b.layers)
	}
	w.u16(uint16(total))
	first := 0
	for _, b := range bases {
		w.u16(uint16(b.gid))
		w.u16(uint16(first))
		w.u16(uint16(len(b.layers)))
		first += len(b.layers)
	}
	for _, b := range bases {
		for _, l := range b.layers {
			w.u16(uint16(l.glyph))
			w.u16(l.paint)
		}
	}
	return w.buf
}

// parseColor reads "#RRGGBB" or "#RRGGBBAA".
func parseColor(s string) (r, g, b, a uint8) {
	s = strings.TrimPrefix(strings.TrimSpace(s), "#")
	a = 255
	if len(s) != 6 && len(s) != 8 {
		return 0, 0, 0, 255
	}
	v, err := strconv.ParseUint(s, 16, 32)
	if err != nil {
		return 0, 0, 0, 255
	}
	if len(s) == 8 {
		return uint8(v >> 24), uint8(v >> 16), uint8(v >> 8), uint8(v)
	}
	return uint8(v >> 16), uint8(v >> 8), uint8(v), a
}

func buildCPAL(palette []string) []byte {
	w := &writer{}
	w.u16(0)
	w.u16(uint16(len(palette))) // entries per palette
	w.u16(1)                    // one palette
	w.u16(uint16(len(palette))) // colour records
	w.u32(14)                   // records right after the header
	w.u16(0)                    // the palette starts at record 0
	for _, c := range palette {
		r, g, b, a := parseColor(c)
		w.u8(b)
		w.u8(g)
		w.u8(r)
		w.u8(a)
	}
	return w.buf
}
