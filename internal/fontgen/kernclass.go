package fontgen

import (
	"encoding/binary"
	"math"
	"sort"
	"strings"

	"github.com/GeekFreak01/spline/internal/project"
)

// kernClasses is the kerning of groups against groups as one class table
// (PairPos format 2) instead of every glyph pair spelled out, which keeps
// a font with big groups small. The glyph pairs whose value differs from
// what the classes give go in front of it: a pair found there wins, the
// rest falls through to the classes.
type kernClasses struct {
	exceptions []kernPair
	sub        []byte
}

// kernCell is the value of a class pair: the default's value and, in a
// variable font, the row of its deltas (0 when it does not vary).
type kernCell struct {
	value int16
	row   int
}

// noClassKerning: tests build the plain-pair font to compare with.
var noClassKerning bool

// fixedCell: a static font has one master and nothing varies.
func fixedCell(vals []float64) (int16, int) { return int16(math.Round(vals[0])), 0 }

// classKerning returns nil when there is no group+group kerning, or when
// the class table would not make the font smaller. kernings holds the
// kerning of each master (one for a static font); cell turns the values of
// a pair in every master into a value and a row, as for the glyph pairs.
func classKerning(p *project.Project, gid map[string]int, pairs []kernPair,
	kernings []map[string]map[string]float64, cell func([]float64) (int16, int)) *kernClasses {
	if noClassKerning {
		return nil
	}
	used1, used2 := map[string]bool{}, map[string]bool{}
	for _, kern := range kernings {
		for first, seconds := range kern {
			if !strings.HasPrefix(first, "@") || len(first) < 2 {
				continue
			}
			for second := range seconds {
				if strings.HasPrefix(second, "@") && len(second) > 1 {
					used1[first[1:]] = true
					used2[second[1:]] = true
				}
			}
		}
	}
	if len(used1) == 0 {
		return nil
	}
	names1, names2 := sortedNames(used1), sortedNames(used2)
	idx1, idx2 := map[string]int{}, map[string]int{}
	for i, n := range names1 {
		idx1[n] = i + 1 // class 0: not in any of these groups
	}
	for i, n := range names2 {
		idx2[n] = i + 1
	}
	c1, c2 := map[int]int{}, map[int]int{} // glyph id -> class
	for _, g := range p.Glyphs {
		id, ok := gid[g.Name]
		if !ok {
			continue
		}
		if c := idx1[g.KernRight]; c > 0 {
			c1[id] = c
		}
		if c := idx2[g.KernLeft]; c > 0 {
			c2[id] = c
		}
	}
	if len(c1) == 0 || len(c2) == 0 {
		return nil
	}
	n1, n2 := len(names1)+1, len(names2)+1
	if 16+4*n1*n2 > maxPairSubtable {
		return nil
	}
	matrix := make([]kernCell, n1*n2)
	vals := make([]float64, len(kernings))
	vary := false
	for i, a := range names1 {
		for j, b := range names2 {
			set := false
			for mi, kern := range kernings {
				v, ok := kern["@"+a]["@"+b]
				vals[mi] = math.Round(v)
				set = set || ok
			}
			if set {
				v, row := cell(vals)
				matrix[(i+1)*n2+j+1] = kernCell{v, row}
				vary = vary || row > 0
			}
		}
	}
	resolved := make(map[[2]int]bool, len(pairs))
	var ex []kernPair
	for _, kp := range pairs {
		resolved[[2]int{kp.left, kp.right}] = true
		if a, ok := c1[kp.left]; ok && matrix[a*n2+c2[kp.right]] == (kernCell{kp.value, kp.row}) {
			continue
		}
		ex = append(ex, kp)
	}
	// Pairs the classes would kern but the project leaves at zero (a zero
	// exception, or a more specific rule of 0).
	members2 := map[int][]int{}
	for id, c := range c2 {
		members2[c] = append(members2[c], id)
	}
	for l, a := range c1 {
		for b := 1; b < n2; b++ {
			if matrix[a*n2+b] == (kernCell{}) {
				continue
			}
			for _, r := range members2[b] {
				if !resolved[[2]int{l, r}] {
					ex = append(ex, kernPair{left: l, right: r})
				}
			}
		}
	}
	sort.Slice(ex, func(i, j int) bool {
		if ex[i].left != ex[j].left {
			return ex[i].left < ex[j].left
		}
		return ex[i].right < ex[j].right
	})
	sub := classSubtable(c1, c2, n1, n2, matrix, vary)
	if sub == nil {
		return nil
	}
	// The class table must make the kerning smaller than plain pairs.
	plain, err := pairSubtables(pairs)
	if err != nil {
		return nil
	}
	subs, err := pairSubtables(ex)
	if err != nil || size(subs)+len(sub) >= size(plain) {
		return nil
	}
	return &kernClasses{exceptions: ex, sub: sub}
}

func size(subs [][]byte) int {
	n := 0
	for _, s := range subs {
		n += len(s)
	}
	return n
}

func sortedNames(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for n := range m {
		out = append(out, n)
	}
	sort.Strings(out)
	return out
}

// classSubtable writes PairPos format 2 with the XAdvance of the first
// glyph: coverage (the first glyphs), the two class definitions and the
// class1 x class2 values. When some cells vary, every value also gets a
// device offset (from the start of the subtable) to a VariationIndex table
// for its row. Returns nil when it does not fit in 64 KB.
func classSubtable(c1, c2 map[int]int, n1, n2 int, matrix []kernCell, vary bool) []byte {
	var firsts []int
	for id := range c1 {
		firsts = append(firsts, id)
	}
	sort.Ints(firsts)
	coverage := &writer{}
	coverage.u16(1)
	coverage.u16(uint16(len(firsts)))
	for _, id := range firsts {
		coverage.u16(uint16(id))
	}
	cd1, cd2 := classDef(c1), classDef(c2)
	record := 2
	if vary {
		record = 4
	}
	covAt := 16 + record*n1*n2
	cd1At := covAt + len(coverage.buf)
	cd2At := cd1At + len(cd1)
	devStart := cd2At + len(cd2)
	if devStart > 0xFFFF {
		return nil
	}
	format := uint16(0x0004) // XAdvance
	if vary {
		format |= 0x0040 // XAdvDevice
	}
	w := &writer{}
	w.u16(2) // posFormat
	w.u16(uint16(covAt))
	w.u16(format) // valueFormat1
	w.u16(0)      // valueFormat2: none
	w.u16(uint16(cd1At))
	w.u16(uint16(cd2At))
	w.u16(uint16(n1))
	w.u16(uint16(n2))
	devices := &writer{}
	devAt := map[int]int{}
	for _, c := range matrix {
		w.i16(c.value)
		if !vary {
			continue
		}
		if c.row == 0 {
			w.u16(0)
			continue
		}
		at, ok := devAt[c.row]
		if !ok {
			at = devStart + len(devices.buf)
			devAt[c.row] = at
			devices.u16(0)                 // deltaSetOuterIndex: the one ItemVariationData
			devices.u16(uint16(c.row - 1)) // deltaSetInnerIndex
			devices.u16(0x8000)            // VariationIndex
		}
		w.u16(0) // patched below, once the offset is known to fit
		if at > 0xFFFF {
			return nil
		}
		binary.BigEndian.PutUint16(w.buf[len(w.buf)-2:], uint16(at))
	}
	w.bytes(coverage.buf)
	w.bytes(cd1)
	w.bytes(cd2)
	w.bytes(devices.buf)
	if len(w.buf) > maxPairSubtable {
		return nil
	}
	return w.buf
}

// classDef writes ClassDef format 2: runs of consecutive glyph ids that
// share a class.
func classDef(m map[int]int) []byte {
	var ids []int
	for id := range m {
		ids = append(ids, id)
	}
	sort.Ints(ids)
	type run struct{ start, end, class int }
	var runs []run
	for _, id := range ids {
		if n := len(runs); n > 0 && runs[n-1].end == id-1 && runs[n-1].class == m[id] {
			runs[n-1].end = id
			continue
		}
		runs = append(runs, run{id, id, m[id]})
	}
	w := &writer{}
	w.u16(2)
	w.u16(uint16(len(runs)))
	for _, r := range runs {
		w.u16(uint16(r.start))
		w.u16(uint16(r.end))
		w.u16(uint16(r.class))
	}
	return w.buf
}
