package fontgen

import (
	"errors"
	"math"
	"sort"
	"strings"

	"github.com/GeekFreak01/spline/internal/project"
)

// Anchors (extended mode) position glyphs against each other:
//
//   - a base glyph has "top", "bottom", ...; a mark has "_top", "_bottom":
//     the 'mark' feature puts the mark's "_top" onto the base's "top";
//   - a mark that also has "top" carries the next mark ('mkmk');
//   - "entry" and "exit" join handwriting ('curs'): the exit of a letter
//     meets the entry of the next one.
type anchorPoint struct{ x, y int16 }

type glyphAnchors map[string]anchorPoint

func collectAnchors(p *project.Project, gid map[string]int) map[int]glyphAnchors {
	out := map[int]glyphAnchors{}
	for _, g := range p.Glyphs {
		id, ok := gid[g.Name]
		if !ok || len(g.Anchors) == 0 {
			continue
		}
		a := glyphAnchors{}
		for _, an := range g.Anchors {
			a[an.Name] = anchorPoint{int16(math.Round(an.X)), int16(math.Round(an.Y))}
		}
		out[id] = a
	}
	return out
}

func isMark(a glyphAnchors) bool {
	for n := range a {
		if strings.HasPrefix(n, "_") {
			return true
		}
	}
	return false
}

func anchorTable(p anchorPoint) []byte {
	w := &writer{}
	w.u16(1) // format 1
	w.i16(p.x)
	w.i16(p.y)
	return w.buf
}

func sortedIDs(m map[int]glyphAnchors, keep func(int, glyphAnchors) bool) []int {
	var ids []int
	for id, a := range m {
		if keep(id, a) {
			ids = append(ids, id)
		}
	}
	sort.Ints(ids)
	return ids
}

// attachLookup writes one MarkBasePos (kind 4) or MarkMarkPos (kind 6)
// lookup for a single anchor class: marks with "_name" attach to glyphs
// with "name".
func attachLookup(kind uint16, marks, bases []int, all map[int]glyphAnchors, name string) []byte {
	markArray := &writer{}
	markArray.u16(uint16(len(marks)))
	var markAnchors []byte
	for i, id := range marks {
		markArray.u16(0) // class 0: the only class of this lookup
		markArray.u16(uint16(2 + 4*len(marks) + len(markAnchors)))
		_ = i
		markAnchors = append(markAnchors, anchorTable(all[id]["_"+name])...)
	}
	markArray.bytes(markAnchors)

	baseArray := &writer{}
	baseArray.u16(uint16(len(bases)))
	var baseAnchors []byte
	for _, id := range bases {
		baseArray.u16(uint16(2 + 2*len(bases) + len(baseAnchors)))
		baseAnchors = append(baseAnchors, anchorTable(all[id][name])...)
	}
	baseArray.bytes(baseAnchors)

	markCov, baseCov := coverage(marks), coverage(bases)
	const header = 12
	sub := &writer{}
	sub.u16(1) // posFormat
	sub.u16(header)
	sub.u16(uint16(header + len(markCov)))
	sub.u16(1) // classCount
	sub.u16(uint16(header + len(markCov) + len(baseCov)))
	sub.u16(uint16(header + len(markCov) + len(baseCov) + len(markArray.buf)))
	sub.bytes(markCov)
	sub.bytes(baseCov)
	sub.bytes(markArray.buf)
	sub.bytes(baseArray.buf)
	return lookupTable(kind, sub.buf)
}

// cursiveLookup writes a CursivePos lookup from "entry"/"exit" anchors.
func cursiveLookup(ids []int, all map[int]glyphAnchors) []byte {
	cov := coverage(ids)
	head := 6 + 4*len(ids)
	sub := &writer{}
	sub.u16(1)
	sub.u16(uint16(head))
	sub.u16(uint16(len(ids)))
	var anchors []byte
	off := head + len(cov)
	for _, id := range ids {
		for _, n := range []string{"entry", "exit"} {
			if p, ok := all[id][n]; ok {
				sub.u16(uint16(off + len(anchors)))
				anchors = append(anchors, anchorTable(p)...)
			} else {
				sub.u16(0)
			}
		}
	}
	sub.bytes(cov)
	sub.bytes(anchors)
	return lookupTable(3, sub.buf)
}

type layoutFeature struct {
	tag     string
	lookups []int
}

// buildLayout writes a GPOS/GSUB-style table: every script (DFLT, cyrl,
// latn) uses the default language system with all features.
func buildLayout(features []layoutFeature, lookups [][]byte) ([]byte, error) {
	sort.Slice(features, func(i, j int) bool { return features[i].tag < features[j].tag })
	lookupList := &writer{}
	lookupList.u16(uint16(len(lookups)))
	off := 2 + 2*len(lookups)
	for _, l := range lookups {
		if off > 0xFFFF {
			return nil, errors.New("too many positioning rules")
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
		featureList.u16(0)
		featureList.u16(uint16(len(f.lookups)))
		for _, l := range f.lookups {
			featureList.u16(uint16(l))
		}
	}
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
		scriptList.u16(4)
		scriptList.u16(0)
		scriptList.u16(0)
		scriptList.u16(0xFFFF)
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
		return nil, errors.New("too many positioning rules")
	}
	w.u16(uint16(o))
	w.bytes(scriptList.buf)
	w.bytes(featureList.buf)
	w.bytes(lookupList.buf)
	return w.buf, nil
}

// buildGPOS writes kerning, mark attachment and cursive joins. Returns nil
// when the font has none of them.
func buildGPOS(fd *fontData) ([]byte, error) {
	var lookups [][]byte
	var features []layoutFeature
	add := func(tag string, l []byte) {
		for i := range features {
			if features[i].tag == tag {
				features[i].lookups = append(features[i].lookups, len(lookups))
				lookups = append(lookups, l)
				return
			}
		}
		features = append(features, layoutFeature{tag, []int{len(lookups)}})
		lookups = append(lookups, l)
	}
	if len(fd.kern) > 0 {
		l, err := pairLookup(fd.kern)
		if err != nil {
			return nil, err
		}
		add("kern", l)
	}
	all := fd.anchors
	// Anchor classes: every name used by a mark as "_name".
	classes := map[string]bool{}
	for _, a := range all {
		for n := range a {
			if strings.HasPrefix(n, "_") && len(n) > 1 {
				classes[n[1:]] = true
			}
		}
	}
	var names []string
	for n := range classes {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		marks := sortedIDs(all, func(_ int, a glyphAnchors) bool { _, ok := a["_"+n]; return ok })
		bases := sortedIDs(all, func(_ int, a glyphAnchors) bool { _, ok := a[n]; return ok && !isMark(a) })
		if len(bases) > 0 {
			add("mark", attachLookup(4, marks, bases, all, n))
		}
		onMarks := sortedIDs(all, func(_ int, a glyphAnchors) bool { _, ok := a[n]; return ok && isMark(a) })
		if len(onMarks) > 0 {
			add("mkmk", attachLookup(6, marks, onMarks, all, n))
		}
	}
	joins := sortedIDs(all, func(_ int, a glyphAnchors) bool {
		_, en := a["entry"]
		_, ex := a["exit"]
		return en || ex
	})
	if len(joins) > 0 {
		add("curs", cursiveLookup(joins, all))
	}
	if len(lookups) == 0 {
		return nil, nil
	}
	return buildLayout(features, lookups)
}

// buildGDEF marks the mark glyphs (class 3) and the rest (class 1), so
// shapers attach marks and skip them where they should. Returns nil when
// there are no marks.
func buildGDEF(fd *fontData) []byte {
	marks := sortedIDs(fd.anchors, func(_ int, a glyphAnchors) bool { return isMark(a) })
	if len(marks) == 0 {
		return nil
	}
	isM := map[int]bool{}
	for _, id := range marks {
		isM[id] = true
	}
	class := &writer{}
	class.u16(1) // ClassDef format 1: one class per glyph from glyph 1
	class.u16(1)
	class.u16(uint16(len(fd.glyphs) - 1))
	for id := 1; id < len(fd.glyphs); id++ {
		if isM[id] {
			class.u16(3)
		} else {
			class.u16(1)
		}
	}
	w := &writer{}
	w.u16(1)
	w.u16(0)
	w.u16(12) // glyphClassDef right after the header
	w.u16(0)  // attachList
	w.u16(0)  // ligCaretList
	w.u16(0)  // markAttachClassDef
	w.bytes(class.buf)
	return w.buf
}
