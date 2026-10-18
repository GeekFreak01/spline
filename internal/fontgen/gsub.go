package fontgen

import (
	"errors"
	"sort"
	"strings"

	"github.com/GeekFreak01/spline/internal/project"
)

// Glyph substitutions (GSUB): contextual alternates ('calt') and ligatures
// ('liga'). Both features are on by default in browsers and text editors.

type caltRule struct {
	glyph, use int
	prev, next []int // empty = any glyph
}

type ligRule struct {
	comps []int
	use   int
}

// collectSubst resolves the project's rules to glyph ids. Rules that name
// glyphs missing from the font are skipped. A context glyph also matches its
// variants ("о" covers "о.alt", "о.2"), so neighbours that were themselves
// replaced by an earlier rule still count.
func collectSubst(p *project.Project, gid map[string]int) ([]caltRule, []ligRule) {
	variants := map[string][]int{}
	for _, g := range p.Glyphs {
		id, ok := gid[g.Name]
		if !ok {
			continue
		}
		variants[g.Name] = append(variants[g.Name], id)
		for i := strings.IndexByte(g.Name, '.'); i > 0; i = indexFrom(g.Name, '.', i+1) {
			variants[g.Name[:i]] = append(variants[g.Name[:i]], id)
		}
	}
	set := func(names []string) []int {
		var ids []int
		for _, n := range names {
			ids = append(ids, variants[n]...)
		}
		return uniqueSorted(ids)
	}
	var calt []caltRule
	for _, a := range p.Contextual {
		g, ok1 := gid[a.Glyph]
		u, ok2 := gid[a.Use]
		if !ok1 || !ok2 || g == u {
			continue
		}
		r := caltRule{glyph: g, use: u, prev: set(a.Prev), next: set(a.Next)}
		if (len(a.Prev) > 0 && len(r.prev) == 0) || (len(a.Next) > 0 && len(r.next) == 0) || len(r.prev)+len(r.next) == 0 {
			continue
		}
		calt = append(calt, r)
	}
	var ligs []ligRule
	for _, l := range p.Ligatures {
		u, ok := gid[l.Use]
		if !ok || len(l.Glyphs) < 2 {
			continue
		}
		r := ligRule{use: u}
		for _, n := range l.Glyphs {
			id, ok := gid[n]
			if !ok {
				r.comps = nil
				break
			}
			r.comps = append(r.comps, id)
		}
		if r.comps != nil {
			ligs = append(ligs, r)
		}
	}
	return calt, ligs
}

func indexFrom(s string, c byte, from int) int {
	if from >= len(s) {
		return -1
	}
	if i := strings.IndexByte(s[from:], c); i >= 0 {
		return from + i
	}
	return -1
}

func uniqueSorted(ids []int) []int {
	sort.Ints(ids)
	out := ids[:0]
	for i, v := range ids {
		if i == 0 || v != ids[i-1] {
			out = append(out, v)
		}
	}
	return out
}

// coverage writes a Coverage table (format 1) for sorted glyph ids.
func coverage(ids []int) []byte {
	w := &writer{}
	w.u16(1)
	w.u16(uint16(len(ids)))
	for _, id := range ids {
		w.u16(uint16(id))
	}
	return w.buf
}

func lookupTable(kind uint16, sub []byte) []byte {
	w := &writer{}
	w.u16(kind)
	w.u16(0) // lookupFlag
	w.u16(1) // one subtable
	w.u16(8) // right after this header
	w.bytes(sub)
	return w.buf
}

// chainLookup: replace the input glyph (via lookup `apply`) when the glyph
// before it is in prev and the glyph after it is in next. ChainContextSubst
// format 3.
func chainLookup(r caltRule, apply int) []byte {
	var back, ahead [][]byte
	if len(r.prev) > 0 {
		back = append(back, coverage(r.prev))
	}
	if len(r.next) > 0 {
		ahead = append(ahead, coverage(r.next))
	}
	input := coverage([]int{r.glyph})
	header := 2 + 2 + 2*len(back) + 2 + 2 + 2 + 2*len(ahead) + 2 + 4
	w := &writer{}
	tail := &writer{}
	off := func(b []byte) uint16 { o := header + len(tail.buf); tail.bytes(b); return uint16(o) }
	w.u16(3)
	w.u16(uint16(len(back)))
	for _, b := range back {
		w.u16(off(b))
	}
	w.u16(1)
	w.u16(off(input))
	w.u16(uint16(len(ahead)))
	for _, b := range ahead {
		w.u16(off(b))
	}
	w.u16(1)
	w.u16(0) // sequenceIndex
	w.u16(uint16(apply))
	w.bytes(tail.buf)
	return lookupTable(6, w.buf)
}

// singleLookup: glyph -> use. SingleSubst format 2.
func singleLookup(r caltRule) []byte {
	w := &writer{}
	w.u16(2)
	w.u16(8) // coverage after this 8-byte subtable header
	w.u16(1)
	w.u16(uint16(r.use))
	w.bytes(coverage([]int{r.glyph}))
	return lookupTable(1, w.buf)
}

// ligatureLookup: LigatureSubst format 1 with every ligature. In each set
// longer ligatures come first so "ffi" wins over "ff".
func ligatureLookup(ligs []ligRule) []byte {
	sets := map[int][]ligRule{}
	var firsts []int
	for _, l := range ligs {
		if _, ok := sets[l.comps[0]]; !ok {
			firsts = append(firsts, l.comps[0])
		}
		sets[l.comps[0]] = append(sets[l.comps[0]], l)
	}
	sort.Ints(firsts)
	cov := coverage(firsts)
	header := 6 + 2*len(firsts)
	w := &writer{}
	body := &writer{}
	body.bytes(cov)
	w.u16(1)
	w.u16(uint16(header))
	w.u16(uint16(len(firsts)))
	for _, f := range firsts {
		set := sets[f]
		sort.SliceStable(set, func(i, j int) bool { return len(set[i].comps) > len(set[j].comps) })
		w.u16(uint16(header + len(body.buf)))
		s := &writer{}
		s.u16(uint16(len(set)))
		ligs := &writer{}
		for _, l := range set {
			s.u16(uint16(2 + 2*len(set) + len(ligs.buf)))
			ligs.u16(uint16(l.use))
			ligs.u16(uint16(len(l.comps)))
			for _, c := range l.comps[1:] {
				ligs.u16(uint16(c))
			}
		}
		body.bytes(s.buf)
		body.bytes(ligs.buf)
	}
	w.bytes(body.buf)
	return lookupTable(4, w.buf)
}

// buildGSUB writes the GSUB table, or nil when there are no rules.
func buildGSUB(calt []caltRule, ligs []ligRule) ([]byte, error) {
	if len(calt) == 0 && len(ligs) == 0 {
		return nil, nil
	}
	var lookups [][]byte
	n := len(calt)
	for i, r := range calt {
		lookups = append(lookups, chainLookup(r, n+i))
	}
	for _, r := range calt {
		lookups = append(lookups, singleLookup(r))
	}
	type feature struct {
		tag     string
		lookups []int
	}
	var features []feature // sorted by tag
	if n > 0 {
		f := feature{tag: "calt"}
		for i := 0; i < n; i++ {
			f.lookups = append(f.lookups, i)
		}
		features = append(features, f)
	}
	if len(ligs) > 0 {
		features = append(features, feature{tag: "liga", lookups: []int{len(lookups)}})
		lookups = append(lookups, ligatureLookup(ligs))
	}

	lookupList := &writer{}
	lookupList.u16(uint16(len(lookups)))
	off := 2 + 2*len(lookups)
	for _, l := range lookups {
		if off > 0xFFFF {
			return nil, errors.New("too many substitution rules")
		}
		lookupList.u16(uint16(off))
		off += len(l)
	}
	for _, l := range lookups {
		lookupList.bytes(l)
	}

	featureList := &writer{}
	featureList.u16(uint16(len(features)))
	off = 2 + 6*len(features)
	for _, f := range features {
		featureList.bytes([]byte(f.tag))
		featureList.u16(uint16(off))
		off += 4 + 2*len(f.lookups)
	}
	for _, f := range features {
		featureList.u16(0) // featureParams
		featureList.u16(uint16(len(f.lookups)))
		for _, l := range f.lookups {
			featureList.u16(uint16(l))
		}
	}

	// Script list: every script uses the default language system with all
	// features.
	tags := []string{"DFLT", "cyrl", "latn"}
	scriptList := &writer{}
	scriptList.u16(uint16(len(tags)))
	base := 2 + 6*len(tags)
	scriptLen := 4 + 6 + 2*len(features)
	for i, tag := range tags {
		scriptList.bytes([]byte(tag))
		scriptList.u16(uint16(base + i*scriptLen))
	}
	for range tags {
		scriptList.u16(4)      // defaultLangSys right after the script header
		scriptList.u16(0)      // no other languages
		scriptList.u16(0)      // lookupOrder
		scriptList.u16(0xFFFF) // no required feature
		scriptList.u16(uint16(len(features)))
		for i := range features {
			scriptList.u16(uint16(i))
		}
	}

	w := &writer{}
	w.u16(1)
	w.u16(0)
	o := 10
	w.u16(uint16(o))
	o += len(scriptList.buf)
	w.u16(uint16(o))
	o += len(featureList.buf)
	if o > 0xFFFF {
		return nil, errors.New("too many substitution rules")
	}
	w.u16(uint16(o))
	w.bytes(scriptList.buf)
	w.bytes(featureList.buf)
	w.bytes(lookupList.buf)
	return w.buf, nil
}
