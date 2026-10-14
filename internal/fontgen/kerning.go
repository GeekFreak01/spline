package fontgen

import (
	"errors"
	"math"
	"sort"
)

type kernPair struct {
	left, right int // glyph ids
	value       int16
}

// collectKerning turns the project's name-based pairs into glyph-id pairs,
// skipping glyphs that are not in the font and zero values.
func collectKerning(k map[string]map[string]float64, gid map[string]int) []kernPair {
	var out []kernPair
	for left, rights := range k {
		l, ok := gid[left]
		if !ok {
			continue
		}
		for right, v := range rights {
			r, ok := gid[right]
			if !ok || math.Round(v) == 0 {
				continue
			}
			out = append(out, kernPair{l, r, int16(math.Round(v))})
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

// buildGPOS writes a GPOS table with one 'kern' feature (DFLT, cyrl, latn
// scripts) and one pair-adjustment lookup (PairPos format 1, XAdvance of
// the first glyph).
func buildGPOS(pairs []kernPair) ([]byte, error) {
	// PairPos subtable.
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

	// Lookup list with a single lookup.
	lookup := &writer{}
	lookup.u16(2) // pair adjustment
	lookup.u16(0)
	lookup.u16(1)
	lookup.u16(8) // subtable follows the 8-byte lookup header
	lookup.bytes(sub.buf)
	lookupList := &writer{}
	lookupList.u16(1)
	lookupList.u16(4)
	lookupList.bytes(lookup.buf)

	// Feature list: 'kern' -> lookup 0.
	featureList := &writer{}
	featureList.u16(1)
	featureList.bytes([]byte("kern"))
	featureList.u16(8)
	featureList.u16(0) // featureParams
	featureList.u16(1)
	featureList.u16(0)

	// Script list: every script uses the default language system.
	tags := []string{"DFLT", "cyrl", "latn"}
	scriptList := &writer{}
	scriptList.u16(uint16(len(tags)))
	base := 2 + 6*len(tags)
	const scriptLen = 4 + 8 // Script header + LangSys
	for i, tag := range tags {
		scriptList.bytes([]byte(tag))
		scriptList.u16(uint16(base + i*scriptLen))
	}
	for range tags {
		scriptList.u16(4)      // defaultLangSys right after the script header
		scriptList.u16(0)      // no other languages
		scriptList.u16(0)      // lookupOrder
		scriptList.u16(0xFFFF) // no required feature
		scriptList.u16(1)
		scriptList.u16(0) // feature index
	}

	w := &writer{}
	w.u16(1)
	w.u16(0)
	off := 10
	w.u16(uint16(off))
	off += len(scriptList.buf)
	w.u16(uint16(off))
	off += len(featureList.buf)
	if off+len(lookupList.buf) > 0xFFFF {
		return nil, errors.New("too many kerning pairs")
	}
	w.u16(uint16(off))
	w.bytes(scriptList.buf)
	w.bytes(featureList.buf)
	w.bytes(lookupList.buf)
	return w.buf, nil
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
