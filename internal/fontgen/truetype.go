package fontgen

import (
	"math"

	"github.com/GeekFreak01/spline/internal/project"
)

type ttPoint struct {
	x, y int
	on   bool
}

// ttContour converts a contour into TrueType points (quadratic curves).
func ttContour(c project.Contour) []ttPoint {
	var pts []ttPoint
	add := func(v vec, on bool) {
		p := ttPoint{int(math.Round(v.x)), int(math.Round(v.y)), on}
		if l := len(pts); l > 0 && pts[l-1] == p {
			return
		}
		pts = append(pts, p)
	}
	for _, s := range segments(c) {
		add(s.p0, true)
		if s.line {
			continue
		}
		qs := cubicToQuads(s, 0.75)
		for i, q := range qs {
			add(q.c, false)
			if i < len(qs)-1 {
				add(q.p2, true)
			}
		}
	}
	if l := len(pts); l > 1 && pts[0] == pts[l-1] {
		pts = pts[:l-1]
	}
	if len(pts) < 3 {
		return nil
	}
	return pts
}

// buildGlyf writes the 'glyf' and 'loca' tables (long offsets).
func buildGlyf(fd *fontData) (glyf, loca []byte, maxPoints, maxContours int) {
	gw := &writer{}
	lw := &writer{}
	for _, g := range fd.glyphs {
		lw.u32(uint32(len(gw.buf)))
		var contours [][]ttPoint
		for _, c := range g.contours {
			if pts := ttContour(c); pts != nil {
				contours = append(contours, pts)
			}
		}
		if len(contours) == 0 {
			continue
		}
		total := 0
		for _, c := range contours {
			total += len(c)
		}
		maxPoints = max(maxPoints, total)
		maxContours = max(maxContours, len(contours))

		gw.i16(int16(len(contours)))
		gw.i16(int16(g.bbox.minX))
		gw.i16(int16(g.bbox.minY))
		gw.i16(int16(g.bbox.maxX))
		gw.i16(int16(g.bbox.maxY))
		end := -1
		for _, c := range contours {
			end += len(c)
			gw.u16(uint16(end))
		}
		gw.u16(0) // no instructions

		var flags, xs, ys []byte
		px, py := 0, 0
		first := true
		for _, c := range contours {
			for _, p := range c {
				var f byte
				if p.on {
					f |= 0x01
				}
				if first {
					f |= 0x40 // OVERLAP_SIMPLE: contours may overlap
					first = false
				}
				dx, dy := p.x-px, p.y-py
				px, py = p.x, p.y
				xs, f = encodeDelta(xs, f, dx, 0x02, 0x10)
				ys, f = encodeDelta(ys, f, dy, 0x04, 0x20)
				flags = append(flags, f)
			}
		}
		gw.bytes(flags)
		gw.bytes(xs)
		gw.bytes(ys)
		gw.pad4()
	}
	lw.u32(uint32(len(gw.buf)))
	return gw.buf, lw.buf, maxPoints, maxContours
}

// encodeDelta uses the compact one-byte form when possible.
func encodeDelta(buf []byte, f byte, d int, shortBit, sameBit byte) ([]byte, byte) {
	switch {
	case d == 0:
		f |= sameBit
	case d > -256 && d < 256:
		f |= shortBit
		if d > 0 {
			f |= sameBit
		} else {
			d = -d
		}
		buf = append(buf, byte(d))
	default:
		buf = append(buf, byte(uint16(int16(d))>>8), byte(int16(d)))
	}
	return buf, f
}
