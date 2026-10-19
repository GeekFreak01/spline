package fontgen

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/GeekFreak01/spline/internal/project"
)

type kernPair struct {
	left, right int // glyph ids
	value       int16
	row         int // variable fonts: 1 + the row of its deltas in the variation store, 0 = fixed
}

// collectKerning resolves the project's kerning (glyph pairs and group
// pairs) into plain glyph-id pairs. When several entries cover the same
// pair, the most specific one wins (glyph+glyph, glyph+group, group+glyph,
// group+group), as in UFO fonts. Glyphs missing from the font are skipped.
func collectKerning(p *project.Project, gid map[string]int) []kernPair {
	firstGroups := map[string][]int{}  // "@name" -> glyphs whose right side is in it
	secondGroups := map[string][]int{} // "@name" -> glyphs whose left side is in it
	for _, g := range p.Glyphs {
		id, ok := gid[g.Name]
		if !ok {
			continue
		}
		if g.KernRight != "" {
			firstGroups["@"+g.KernRight] = append(firstGroups["@"+g.KernRight], id)
		}
		if g.KernLeft != "" {
			secondGroups["@"+g.KernLeft] = append(secondGroups["@"+g.KernLeft], id)
		}
	}
	resolve := func(key string, groups map[string][]int) ([]int, bool) {
		if strings.HasPrefix(key, "@") {
			return groups[key], true
		}
		if id, ok := gid[key]; ok {
			return []int{id}, false
		}
		return nil, false
	}
	type entry struct {
		value int16
		level int // 0 = most specific
	}
	resolved := map[[2]int]entry{}
	for first, seconds := range p.Kerning {
		ls, lGroup := resolve(first, firstGroups)
		for second, v := range seconds {
			rs, rGroup := resolve(second, secondGroups)
			level := 0
			if rGroup {
				level++
			}
			if lGroup {
				level += 2
			}
			for _, l := range ls {
				for _, r := range rs {
					k := [2]int{l, r}
					if e, ok := resolved[k]; !ok || level < e.level {
						resolved[k] = entry{int16(math.Round(v)), level}
					}
				}
			}
		}
	}
	var out []kernPair
	for k, e := range resolved {
		if e.value != 0 { // a zero exception simply cancels group kerning
			out = append(out, kernPair{left: k[0], right: k[1], value: e.value})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].left != out[j].left {
			return out[i].left < out[j].left
		}
		return out[i].right < out[j].right
	})
	return out
}

// pairLookup writes the kerning lookup: PairPos format 1 with the
// XAdvance of the first glyph. When some pairs vary (a variable font with
// kerning per master), every value also gets a device offset, pointing to
// a VariationIndex table for the varying ones (0 for the fixed ones).
func pairLookup(pairs []kernPair) ([]byte, error) {
	vary := false
	for _, p := range pairs {
		vary = vary || p.row > 0
	}
	var firsts []int
	sets := map[int][]kernPair{}
	for _, p := range pairs {
		if len(sets[p.left]) == 0 {
			firsts = append(firsts, p.left)
		}
		sets[p.left] = append(sets[p.left], p)
	}
	sub := &writer{}
	headerLen := 10 + 2*len(firsts)
	coverage := &writer{}
	coverage.u16(1)
	coverage.u16(uint16(len(firsts)))
	for _, g := range firsts {
		coverage.u16(uint16(g))
	}
	pairSets := &writer{}
	offsets := make([]int, len(firsts))
	// Where a device offset goes, its row, and the start of its PairSet:
	// in format 1 the offset counts from the PairSet.
	type devRef struct{ at, row, set int }
	var devs []devRef
	for i, g := range firsts {
		offsets[i] = headerLen + len(coverage.buf) + len(pairSets.buf)
		pairSets.u16(uint16(len(sets[g])))
		for _, p := range sets[g] {
			pairSets.u16(uint16(p.right))
			pairSets.i16(p.value)
			if vary {
				if p.row > 0 {
					devs = append(devs, devRef{len(pairSets.buf), p.row - 1, offsets[i]})
				}
				pairSets.u16(0) // patched below
			}
		}
	}
	// One VariationIndex table per row, after the pair sets.
	tail := headerLen + len(coverage.buf) + len(pairSets.buf)
	devAt := map[int]int{}
	devices := &writer{}
	for _, d := range devs {
		at, ok := devAt[d.row]
		if !ok {
			at = tail + len(devices.buf)
			devAt[d.row] = at
			devices.u16(0)             // deltaSetOuterIndex: the one ItemVariationData
			devices.u16(uint16(d.row)) // deltaSetInnerIndex
			devices.u16(0x8000)        // VariationIndex
		}
		if at-d.set > 0xFFFF {
			return nil, errors.New("too many kerning pairs")
		}
		binary.BigEndian.PutUint16(pairSets.buf[d.at:], uint16(at-d.set))
	}
	if tail+len(devices.buf) > 0xFFFF {
		return nil, errors.New("too many kerning pairs")
	}
	format := uint16(0x0004) // XAdvance
	if vary {
		format |= 0x0040 // XAdvDevice
	}
	sub.u16(1)                 // posFormat
	sub.u16(uint16(headerLen)) // coverage right after the header
	sub.u16(format)            // valueFormat1
	sub.u16(0)                 // valueFormat2: none
	sub.u16(uint16(len(firsts)))
	for _, o := range offsets {
		sub.u16(uint16(o))
	}
	sub.bytes(coverage.buf)
	sub.bytes(pairSets.buf)
	sub.bytes(devices.buf)
	return lookupTable(2, sub.buf), nil
}

// buildKern writes the legacy 'kern' table (format 0) used by older
// applications. Returns nil when there are too many pairs for it.
func buildKern(pairs []kernPair) []byte {
	n := len(pairs)
	length := 14 + 6*n
	if length > 0xFFFF {
		return nil
	}
	pow, log := 1, 0
	for pow*2 <= n {
		pow *= 2
		log++
	}
	w := &writer{}
	w.u16(0) // version
	w.u16(1) // nTables
	w.u16(0) // subtable version
	w.u16(uint16(length))
	w.u16(0x0001) // horizontal, format 0
	w.u16(uint16(n))
	w.u16(uint16(pow * 6))
	w.u16(uint16(log))
	w.u16(uint16((n - pow) * 6))
	for _, p := range pairs {
		w.u16(uint16(p.left))
		w.u16(uint16(p.right))
		w.i16(p.value)
	}
	return w.buf
}

// varyKerning gives a variable font the kerning of every master: pairs whose
// value differs between masters get a row of deltas (one per region, in the
// order of the masters' regions), kept in fd.kernRows for the variation
// store in GDEF. A master without its own kerning has the default's.
func varyKerning(p *project.Project, fd *fontData) {
	vf := fd.vf
	values := make([]map[[2]int]float64, len(vf.masters))
	keys := map[[2]int]bool{}
	for mi, m := range vf.masters {
		q := *p
		if mi > 0 && m.Kerning != nil {
			q.Kerning = m.Kerning
		}
		values[mi] = map[[2]int]float64{}
		for _, kp := range collectKerning(&q, fd.gid) {
			k := [2]int{kp.left, kp.right}
			values[mi][k] = float64(kp.value)
			keys[k] = true
		}
	}
	rowOf := map[string]int{}
	var pairs []kernPair
	for k := range keys {
		base := values[0][k]
		deltas := map[int]float64{}
		row := make([]int16, len(vf.order))
		moves := false
		for oi, mi := range vf.order {
			d := values[mi][k] - base
			// Minus what the masters before it already give at its place.
			for _, mj := range vf.order[:oi] {
				d -= scalar(vf.regions[mj], vf.norm[mi]) * deltas[mj]
			}
			deltas[mi] = d
			row[oi] = int16(math.Round(d))
			moves = moves || row[oi] != 0
		}
		kp := kernPair{left: k[0], right: k[1], value: int16(base)}
		if moves {
			key := fmt.Sprint(row)
			r, ok := rowOf[key]
			if !ok {
				fd.kernRows = append(fd.kernRows, row)
				r = len(fd.kernRows)
				rowOf[key] = r
			}
			kp.row = r
		} else if kp.value == 0 {
			continue
		}
		pairs = append(pairs, kp)
	}
	sort.Slice(pairs, func(i, j int) bool {
		if pairs[i].left != pairs[j].left {
			return pairs[i].left < pairs[j].left
		}
		return pairs[i].right < pairs[j].right
	})
	fd.kern = pairs
}

// buildVarStore writes the ItemVariationStore of the varying kerning: the
// regions of the masters and one ItemVariationData with all rows. Returns
// nil when nothing varies.
func buildVarStore(fd *fontData) []byte {
	vf := fd.vf
	if vf == nil || len(fd.kernRows) == 0 {
		return nil
	}
	regions := &writer{}
	regions.u16(uint16(len(vf.axes)))
	regions.u16(uint16(len(vf.order)))
	for _, mi := range vf.order {
		for k := range vf.axes {
			r := vf.regions[mi][k]
			regions.u16(f2dot14(r.start))
			regions.u16(f2dot14(r.peak))
			regions.u16(f2dot14(r.end))
		}
	}
	data := &writer{}
	data.u16(uint16(len(fd.kernRows)))
	data.u16(uint16(len(vf.order))) // every delta is a 16-bit word
	data.u16(uint16(len(vf.order)))
	for i := range vf.order {
		data.u16(uint16(i))
	}
	for _, row := range fd.kernRows {
		for _, d := range row {
			data.i16(d)
		}
	}
	w := &writer{}
	w.u16(1)  // format
	w.u32(12) // variationRegionList right after the header
	w.u16(1)  // one ItemVariationData
	w.u32(uint32(12 + len(regions.buf)))
	w.bytes(regions.buf)
	w.bytes(data.buf)
	return w.buf
}
