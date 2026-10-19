package fontgen

import (
	"errors"
	"fmt"
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
	axes    []project.Axis   // min/max from the masters
	defs    []float64        // default location on each axis
	masters []project.Master // [0] is the default
	norm    [][]float64      // normalized location of each master
	order   []int            // masters in the order their deltas are worked out
	regions [][]region       // by master: per axis, peak 0 = not used
	glyphs  []varGlyph       // by glyph id
	names   []string         // instance names, name IDs after the axis names
	locs    [][]float64      // instance locations
}

type region struct{ start, peak, end float64 }

func normLoc(loc, def, min, max float64) float64 {
	switch {
	case loc < def && def > min:
		return math.Max(-1, (loc-def)/(def-min))
	case loc > def && max > def:
		return math.Min(1, (loc-def)/(max-def))
	}
	return 0
}

// scalar is how much a (normalized) location is inside a region.
func scalar(reg []region, nl []float64) float64 {
	s := 1.0
	for k, r := range reg {
		if r.peak == 0 {
			continue
		}
		v := nl[k]
		if v == r.peak {
			continue
		}
		lo, hi := math.Min(r.start, r.end), math.Max(r.start, r.end)
		if v < lo || v > hi {
			return 0
		}
		if (r.peak > 0 && v < r.peak) || (r.peak < 0 && v > r.peak) {
			s *= (v - r.start) / (r.peak - r.start)
		} else {
			s *= (r.end - v) / (r.end - r.peak)
		}
	}
	return s
}

func nonZero(v []float64) (n int) {
	for _, x := range v {
		if x != 0 {
			n++
		}
	}
	return
}

// model sets the regions and their order, as fontTools' VariationModel
// does for masters on the axes and in the corners.
func (vf *varData) model() {
	n := len(vf.masters)
	vf.regions = make([][]region, n)
	for i := 1; i < n; i++ {
		if nonZero(vf.norm[i]) > 0 {
			vf.order = append(vf.order, i)
		}
	}
	sort.SliceStable(vf.order, func(a, b int) bool {
		x, y := vf.norm[vf.order[a]], vf.norm[vf.order[b]]
		if nonZero(x) != nonZero(y) {
			return nonZero(x) < nonZero(y)
		}
		sx, sy := 0.0, 0.0
		for k := range x {
			sx += math.Abs(x[k])
			sy += math.Abs(y[k])
		}
		return sx < sy
	})
	for _, i := range vf.order {
		nl := vf.norm[i]
		reg := make([]region, len(nl))
		for k, pk := range nl {
			if pk == 0 {
				continue
			}
			start, end := 0.0, pk
			if nonZero(nl) == 1 { // on one axis: neighbours split it
				for _, j := range vf.order {
					o := vf.norm[j]
					if j == i || nonZero(o) != 1 || o[k] == 0 || (o[k] > 0) != (pk > 0) {
						continue
					}
					if math.Abs(o[k]) < math.Abs(pk) && math.Abs(o[k]) > math.Abs(start) {
						start = o[k]
					}
					if math.Abs(o[k]) > math.Abs(pk) && (end == pk || math.Abs(o[k]) < math.Abs(end)) {
						end = o[k]
					}
				}
			}
			reg[k] = region{start, pk, end}
		}
		vf.regions[i] = reg
	}
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
	axes := []*project.Axis{p.Axis}
	if p.Axis2 != nil {
		axes = append(axes, p.Axis2)
	}
	locOf := func(m project.Master, k int) float64 {
		if k == 0 {
			return m.Loc
		}
		if m.Loc2 == 0 {
			return 100
		}
		return m.Loc2
	}
	vf := &varData{masters: p.Masters}
	for k, a := range axes {
		def := locOf(p.Masters[0], k)
		lo, hi := def, def
		for _, m := range p.Masters {
			lo, hi = math.Min(lo, locOf(m, k)), math.Max(hi, locOf(m, k))
		}
		vf.axes = append(vf.axes, project.Axis{Tag: a.Tag, Min: lo, Max: hi})
		vf.defs = append(vf.defs, def)
	}
	for _, m := range p.Masters {
		nl := make([]float64, len(axes))
		for k := range axes {
			nl[k] = normLoc(locOf(m, k), vf.defs[k], vf.axes[k].Min, vf.axes[k].Max)
		}
		vf.norm = append(vf.norm, nl)
	}
	vf.model()
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
	// Instances: the masters, plus the usual weights in between (at the
	// default of the second axis).
	names := map[int]string{100: "Thin", 200: "ExtraLight", 300: "Light", 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black"}
	seen := map[string]bool{}
	type inst struct {
		name string
		loc  []float64
	}
	var list []inst
	key := func(l []float64) string { return fmt.Sprint(l) }
	for _, m := range p.Masters {
		l := []float64{m.Loc}
		if len(axes) > 1 {
			l = append(l, locOf(m, 1))
		}
		if !seen[key(l)] {
			seen[key(l)] = true
			list = append(list, inst{m.Name, l})
		}
	}
	if strings.EqualFold(p.Axis.Tag, "wght") {
		for w := 100; w <= 900; w += 100 {
			l := []float64{float64(w)}
			if len(axes) > 1 {
				l = append(l, vf.defs[1])
			}
			if float64(w) > vf.axes[0].Min && float64(w) < vf.axes[0].Max && !seen[key(l)] {
				seen[key(l)] = true
				list = append(list, inst{names[w], l})
			}
		}
	}
	sort.SliceStable(list, func(i, j int) bool {
		a, b := list[i].loc, list[j].loc
		if len(a) > 1 && a[1] != b[1] {
			return a[1] > b[1]
		}
		return a[0] < b[0]
	})
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
	nAxes := len(vf.axes)
	var data [][]byte
	for gi, vg := range vf.glyphs {
		if vg.masters == nil || len(fd.glyphs[gi].contours) == 0 {
			data = append(data, nil)
			continue
		}
		mp := varPoints(vg)
		// Points of every master as numbers (x, y, then 4 phantom points).
		flatPts := func(mi int) []float64 {
			var out []float64
			for _, c := range mp[mi] {
				for _, p := range c {
					out = append(out, float64(p.x), float64(p.y))
				}
			}
			adv := float64(vg.advance[mi])
			return append(out, 0, 0, adv, 0, 0, 0, 0, 0)
		}
		base := flatPts(0)
		deltas := map[int][]float64{}
		var tuples [][]byte
		var headers []byte
		for oi, mi := range vf.order {
			d := flatPts(mi)
			for k := range d {
				d[k] -= base[k]
			}
			// Minus what the masters before it already give at its place.
			for _, mj := range vf.order[:oi] {
				if sc := scalar(vf.regions[mj], vf.norm[mi]); sc != 0 {
					for k := range d {
						d[k] -= sc * deltas[mj][k]
					}
				}
			}
			deltas[mi] = d
			var dx, dy []int
			any := false
			for k := 0; k < len(d); k += 2 {
				x, y := int(math.Round(d[k])), int(math.Round(d[k+1]))
				dx, dy = append(dx, x), append(dy, y)
				if x != 0 || y != 0 {
					any = true
				}
			}
			if !any {
				continue
			}
			body := &writer{}
			packDeltas(body, dx)
			packDeltas(body, dy)
			reg := vf.regions[mi]
			h := &writer{}
			h.u16(uint16(len(body.buf)))
			flags := uint16(0x8000) // embedded peak
			inter := false
			for _, r := range reg {
				if r.peak != 0 && !(r.start == 0 && r.end == r.peak) {
					inter = true
				}
			}
			if inter {
				flags |= 0x4000 // intermediate region
			}
			h.u16(flags)
			for _, r := range reg {
				h.u16(f2dot14(r.peak))
			}
			if inter {
				for _, r := range reg {
					h.u16(f2dot14(math.Min(r.start, r.end)))
				}
				for _, r := range reg {
					h.u16(f2dot14(math.Max(r.start, r.end)))
				}
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
	w.u16(uint16(nAxes))
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
	n := len(vf.axes)
	w := &writer{}
	w.u16(1)
	w.u16(0)
	w.u16(16) // axes right after the header
	w.u16(2)  // reserved
	w.u16(uint16(n))
	w.u16(20) // axisSize
	w.u16(uint16(len(vf.names)))
	w.u16(uint16(4 + 4*n)) // instanceSize
	fixed := func(v float64) { w.u32(uint32(int32(math.Round(v * 65536)))) }
	for k, a := range vf.axes {
		w.bytes([]byte(padTag(a.Tag)))
		fixed(a.Min)
		fixed(vf.defs[k])
		fixed(a.Max)
		w.u16(0)
		w.u16(uint16(256 + k))
	}
	for i, loc := range vf.locs {
		w.u16(uint16(256 + n + i))
		w.u16(0)
		for _, v := range loc {
			fixed(v)
		}
	}
	return w.buf
}

// buildSTAT describes the styles along the axes for font menus: the
// instance names on the first axis, the master names on the second.
func buildSTAT(fd *fontData) []byte {
	vf := fd.vf
	n := len(vf.axes)
	type value struct {
		axis   int
		name   uint16
		v      float64
		elided bool
	}
	var vals []value
	seen := map[float64]bool{}
	for i, loc := range vf.locs {
		if n > 1 && loc[1] != vf.defs[1] {
			continue
		}
		if !seen[loc[0]] {
			seen[loc[0]] = true
			vals = append(vals, value{0, uint16(256 + n + i), loc[0], loc[0] == vf.defs[0]})
		}
	}
	if n > 1 {
		seen2 := map[float64]bool{vf.defs[1]: true}
		for i, loc := range vf.locs {
			if !seen2[loc[1]] {
				seen2[loc[1]] = true
				vals = append(vals, value{1, uint16(256 + n + i), loc[1], false})
			}
		}
	}
	w := &writer{}
	w.u16(1)
	w.u16(1) // version 1.1
	w.u16(8) // designAxisSize
	w.u16(uint16(n))
	w.u32(20) // designAxesOffset
	w.u16(uint16(len(vals)))
	w.u32(uint32(20 + 8*n)) // offsetToAxisValueOffsets
	w.u16(2)                // elidedFallbackNameID: "Regular"
	for k, a := range vf.axes {
		w.bytes([]byte(padTag(a.Tag)))
		w.u16(uint16(256 + k))
		w.u16(uint16(k))
	}
	base := 2 * len(vals)
	for i := range vals {
		w.u16(uint16(base + 12*i))
	}
	for _, v := range vals {
		w.u16(1) // format 1
		w.u16(uint16(v.axis))
		var flags uint16
		if v.elided {
			flags = 0x0002 // ELIDABLE_AXIS_VALUE_NAME
		}
		w.u16(flags)
		w.u16(v.name)
		w.u32(uint32(int32(math.Round(v.v * 65536))))
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
