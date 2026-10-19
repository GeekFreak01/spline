package fontgen

import (
	"errors"
	"math"
	"sort"
	"strings"

	"github.com/GeekFreak01/spline/internal/project"
)

// Variable TrueType fonts (extended mode): the default master becomes the
// 'glyf' outlines, every other master a set of point deltas in 'gvar';
// 'fvar' names the axis and the instances, 'STAT' describes the styles.
//
// Interpolation needs the same points in every master, so each master's
// contours go through the same plan: the same contours kept and reversed
// (decided on the default) and every curve split into the same number of
// quadratic pieces (the most any master needs).

type varGlyph struct {
	masters [][]project.Contour // per master, normalized and rounded; nil when not compatible
	advance []int               // per master
}

type varData struct {
	axis    project.Axis
	masters []project.Master // [0] is the default
	norm    []float64        // normalized location of each master
	glyphs  []varGlyph       // by glyph id
	names   []string         // instance names, from name ID 257
	locs    []float64        // instance locations
}

func normLoc(loc, def, min, max float64) float64 {
	switch {
	case loc < def && def > min:
		return math.Max(-1, (loc-def)/(def-min))
	case loc > def && max > def:
		return math.Min(1, (loc-def)/(max-def))
	}
	return 0
}

// sameShape tells whether two outlines can be blended point by point.
func sameShape(a, b []project.Contour) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if len(a[i].Nodes) != len(b[i].Nodes) {
			return false
		}
		for k := range a[i].Nodes {
			x, y := a[i].Nodes[k], b[i].Nodes[k]
			if (x.In == nil) != (y.In == nil) || (x.Out == nil) != (y.Out == nil) {
				return false
			}
		}
	}
	return true
}

// prepareVar fills fd.vf for a project with masters.
func prepareVar(p *project.Project, fd *fontData, src []project.Glyph) error {
	if len(p.Masters) < 2 || p.Axis == nil {
		return errors.New("a variable font needs at least two masters")
	}
	def := p.Masters[0].Loc
	min, max := def, def
	for _, m := range p.Masters {
		min, max = math.Min(min, m.Loc), math.Max(max, m.Loc)
	}
	vf := &varData{axis: project.Axis{Tag: p.Axis.Tag, Min: min, Max: max}, masters: p.Masters}
	for _, m := range p.Masters {
		vf.norm = append(vf.norm, normLoc(m.Loc, def, min, max))
	}
	for i, g := range src {
		vg := varGlyph{}
		if i > 0 { // .notdef does not vary
			base := g.Outline()
			keep, rev := normalizePlan(base, false)
			plan := func(cs []project.Contour) []project.Contour {
				out := make([]project.Contour, 0, len(keep))
				for j, k := range keep {
					if k >= len(cs) {
						return nil
					}
					c := cs[k]
					if rev[j] {
						c = reverse(c)
					}
					out = append(out, c)
				}
				return roundContours(out)
			}
			ok := true
			for mi, m := range p.Masters {
				var cs []project.Contour
				adv := g.Advance
				if mi == 0 {
					cs = base
				} else if l, has := g.Layers[m.ID]; has {
					cs, adv = l.Contours, l.Advance
				} else {
					cs = base
				}
				if len(cs) != len(base) {
					ok = false
				}
				pc := plan(cs)
				if pc == nil || (mi > 0 && !sameShape(vg.masters[0], pc)) {
					ok = false
				}
				vg.masters = append(vg.masters, pc)
				vg.advance = append(vg.advance, int(math.Round(adv)))
			}
			if !ok {
				vg.masters = nil // drawn differently in some master: no variation
			}
		}
		vf.glyphs = append(vf.glyphs, vg)
	}
	// Instances: the masters, plus the usual weights in between.
	names := map[int]string{100: "Thin", 200: "ExtraLight", 300: "Light", 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black"}
	seen := map[float64]bool{}
	type inst struct {
		name string
		loc  float64
	}
	var list []inst
	for _, m := range p.Masters {
		if !seen[m.Loc] {
			seen[m.Loc] = true
			list = append(list, inst{m.Name, m.Loc})
		}
	}
	if strings.EqualFold(p.Axis.Tag, "wght") {
		for w := 100; w <= 900; w += 100 {
			if float64(w) > min && float64(w) < max && !seen[float64(w)] {
				seen[float64(w)] = true
				list = append(list, inst{names[w], float64(w)})
			}
		}
	}
	sort.Slice(list, func(i, j int) bool { return list[i].loc < list[j].loc })
	for _, x := range list {
		vf.names = append(vf.names, x.name)
		vf.locs = append(vf.locs, x.loc)
	}
	fd.vf = vf
	return nil
}

// ttPointsN converts a contour to TrueType points with a fixed number of
// quadratic pieces per curve (pieces[i] for segment i), so every master
// gets the same points.
func ttPointsN(c project.Contour, pieces []int) []ttPoint {
	var pts []ttPoint
	add := func(v vec, on bool) { pts = append(pts, ttPoint{int(math.Round(v.x)), int(math.Round(v.y)), on}) }
	for i, s := range segments(c) {
		add(s.p0, true)
		if s.line {
			continue
		}
		n := pieces[i]
		for k := 0; k < n; k++ {
			part := splitCubic(s, float64(k)/float64(n), float64(k+1)/float64(n))
			add(part.c1.add(part.c2).mul(3).sub(part.p0).sub(part.p3).mul(0.25), false)
			if k < n-1 {
				add(part.p3, true)
			}
		}
	}
	return pts
}

// varPoints returns the TrueType contours of a varying glyph for every
// master, all with the same points.
func varPoints(vg varGlyph) [][][]ttPoint {
	base := vg.masters[0]
	out := make([][][]ttPoint, len(vg.masters))
	for ci := range base {
		segsN := len(segments(base[ci]))
		pieces := make([]int, segsN)
		for _, m := range vg.masters {
			for si, s := range segments(m[ci]) {
				if !s.line {
					pieces[si] = max(pieces[si], len(cubicToQuads(s, 0.75)))
				}
			}
		}
		for mi, m := range vg.masters {
			out[mi] = append(out[mi], ttPointsN(m[ci], pieces))
		}
	}
	return out
}

func f2dot14(v float64) uint16 { return uint16(int16(math.Round(v * 16384))) }

// packDeltas writes point deltas in the packed form of 'gvar'.
func packDeltas(w *writer, ds []int) {
	for i := 0; i < len(ds); {
		n := min(64, len(ds)-i)
		allZero, small := true, true
		for _, d := range ds[i : i+n] {
			if d != 0 {
				allZero = false
			}
			if d < -128 || d > 127 {
				small = false
			}
		}
		switch {
		case allZero:
			w.u8(0x80 | byte(n-1))
		case small:
			w.u8(byte(n - 1))
			for _, d := range ds[i : i+n] {
				w.u8(byte(int8(d)))
			}
		default:
			w.u8(0x40 | byte(n-1))
			for _, d := range ds[i : i+n] {
				w.i16(int16(d))
			}
		}
		i += n
	}
}

// buildGvar writes the deltas of every non-default master. pts holds the
// default points of each glyph, as written to 'glyf'.
func buildGvar(fd *fontData) []byte {
	vf := fd.vf
	n := len(vf.masters)
	// Region of each master on the axis: from its neighbour towards the
	// default to its own place, then down to the next master outwards.
	type region struct{ start, peak, end float64 }
	regions := make([]region, n)
	for i := 1; i < n; i++ {
		pk := vf.norm[i]
		start, end := 0.0, pk
		for j := 1; j < n; j++ {
			o := vf.norm[j]
			if j == i || (o > 0) != (pk > 0) {
				continue
			}
			if math.Abs(o) < math.Abs(pk) && math.Abs(o) > math.Abs(start) {
				start = o
			}
			if math.Abs(o) > math.Abs(pk) && (end == pk || math.Abs(o) < math.Abs(end)) {
				end = o
			}
		}
		regions[i] = region{start, pk, end}
	}

	var data [][]byte
	for gi, vg := range vf.glyphs {
		if vg.masters == nil || len(fd.glyphs[gi].contours) == 0 {
			data = append(data, nil)
			continue
		}
		mp := varPoints(vg)
		var tuples [][]byte
		var headers []byte
		for mi := 1; mi < n; mi++ {
			if vf.norm[mi] == 0 {
				continue
			}
			var dx, dy []int
			any := false
			for ci, c := range mp[0] {
				for k, p0 := range c {
					q := mp[mi][ci][k]
					dx, dy = append(dx, q.x-p0.x), append(dy, q.y-p0.y)
					if q.x != p0.x || q.y != p0.y {
						any = true
					}
				}
			}
			// Phantom points: origin, advance, and two vertical ones.
			adv := vg.advance[mi] - vg.advance[0]
			dx = append(dx, 0, adv, 0, 0)
			dy = append(dy, 0, 0, 0, 0)
			if !any && adv == 0 {
				continue
			}
			body := &writer{}
			packDeltas(body, dx)
			packDeltas(body, dy)
			r := regions[mi]
			h := &writer{}
			h.u16(uint16(len(body.buf)))
			flags := uint16(0x8000) // embedded peak
			inter := !(r.start == 0 && r.end == r.peak)
			if inter {
				flags |= 0x4000 // intermediate region
			}
			h.u16(flags)
			h.u16(f2dot14(r.peak))
			if inter {
				h.u16(f2dot14(math.Min(r.start, r.end)))
				h.u16(f2dot14(math.Max(r.start, r.end)))
			}
			headers = append(headers, h.buf...)
			tuples = append(tuples, body.buf)
		}
		if len(tuples) == 0 {
			data = append(data, nil)
			continue
		}
		w := &writer{}
		// Shared point numbers = one zero byte: every tuple moves all points.
		w.u16(0x8000 | uint16(len(tuples)))
		w.u16(uint16(4 + len(headers)))
		w.bytes(headers)
		w.u8(0)
		for _, b := range tuples {
			w.bytes(b)
		}
		w.pad4()
		data = append(data, w.buf)
	}

	w := &writer{}
	w.u16(1)
	w.u16(0)
	w.u16(1) // axisCount
	w.u16(0) // sharedTupleCount
	glyphCount := len(fd.glyphs)
	head := 20 + 4*(glyphCount+1)
	w.u32(uint32(head)) // sharedTuplesOffset (none, points at the data)
	w.u16(uint16(glyphCount))
	w.u16(1) // long offsets
	w.u32(uint32(head))
	off := 0
	for _, d := range data {
		w.u32(uint32(off))
		off += len(d)
	}
	w.u32(uint32(off))
	for _, d := range data {
		w.bytes(d)
	}
	return w.buf
}

// buildFvar writes the axis and the named instances; axisName and the
// instance names are name IDs 256 and 257...
func buildFvar(fd *fontData) []byte {
	vf := fd.vf
	w := &writer{}
	w.u16(1)
	w.u16(0)
	w.u16(16) // axes right after the header
	w.u16(2)  // reserved
	w.u16(1)  // axisCount
	w.u16(20) // axisSize
	w.u16(uint16(len(vf.names)))
	w.u16(4 + 4) // instanceSize: subfamilyNameID, flags, one coordinate
	fixed := func(v float64) { w.u32(uint32(int32(math.Round(v * 65536)))) }
	w.bytes([]byte(padTag(vf.axis.Tag)))
	fixed(vf.axis.Min)
	fixed(vf.masters[0].Loc)
	fixed(vf.axis.Max)
	w.u16(0)
	w.u16(256)
	for i, loc := range vf.locs {
		w.u16(uint16(257 + i))
		w.u16(0)
		fixed(loc)
	}
	return w.buf
}

// buildSTAT describes the styles along the axis for font menus.
func buildSTAT(fd *fontData) []byte {
	vf := fd.vf
	w := &writer{}
	w.u16(1)
	w.u16(1)  // version 1.1
	w.u16(8)  // designAxisSize
	w.u16(1)  // designAxisCount
	w.u32(20) // designAxesOffset
	w.u16(uint16(len(vf.locs)))
	w.u32(uint32(20 + 8)) // offsetToAxisValueOffsets
	w.u16(2)              // elidedFallbackNameID: "Regular"
	w.bytes([]byte(padTag(vf.axis.Tag)))
	w.u16(256)
	w.u16(0)
	// Axis value offsets (from the offsets array), then format 1 tables.
	base := 2 * len(vf.locs)
	for i := range vf.locs {
		w.u16(uint16(base + 12*i))
	}
	for i, loc := range vf.locs {
		w.u16(1) // format 1
		w.u16(0) // axis 0
		var flags uint16
		if loc == vf.masters[0].Loc {
			flags = 0x0002 // ELIDABLE_AXIS_VALUE_NAME
		}
		w.u16(flags)
		w.u16(uint16(257 + i))
		w.u32(uint32(int32(math.Round(loc * 65536))))
	}
	return w.buf
}

func padTag(t string) string {
	for len(t) < 4 {
		t += " "
	}
	return t[:4]
}

func axisName(tag string) string {
	switch strings.ToLower(tag) {
	case "wght":
		return "Weight"
	case "wdth":
		return "Width"
	case "slnt":
		return "Slant"
	}
	return tag
}
