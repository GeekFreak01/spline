package fontgen

import (
	"errors"
	"math"
	"sort"
	"strings"

	"github.com/GeekFreak01/spline/internal/project"
)

type kernPair struct {
	left, right int // glyph ids
	value       int16
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
			out = append(out, kernPair{k[0], k[1], e.value})
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
// XAdvance of the first glyph.
func pairLookup(pairs []kernPair) ([]byte, error) {
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
	for i, g := range firsts {
		offsets[i] = headerLen + len(coverage.buf) + len(pairSets.buf)
		pairSets.u16(uint16(len(sets[g])))
		for _, p := range sets[g] {
			pairSets.u16(uint16(p.right))
			pairSets.i16(p.value)
		}
	}
	if headerLen+len(coverage.buf)+len(pairSets.buf) > 0xFFFF {
		return nil, errors.New("too many kerning pairs")
	}
	sub.u16(1)                 // posFormat
	sub.u16(uint16(headerLen)) // coverage right after the header
	sub.u16(0x0004)            // valueFormat1: XAdvance
	sub.u16(0)                 // valueFormat2: none
	sub.u16(uint16(len(firsts)))
	for _, o := range offsets {
		sub.u16(uint16(o))
	}
	sub.bytes(coverage.buf)
	sub.bytes(pairSets.buf)
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
