package fontgen

import (
	"math"
	"sort"
	"strconv"
	"strings"

	"github.com/GeekFreak01/spline/internal/project"
)

// buildCFF writes a minimal CFF (version 1) table with Type 2 charstrings.
func buildCFF(fd *fontData) []byte {
	var strs []string
	sid := func(s string) int {
		strs = append(strs, s)
		return 391 + len(strs) - 1
	}
	fullSID := sid(fd.names.full)
	familySID := sid(fd.info.FamilyName)
	glyphSIDs := make([]int, len(fd.glyphs))
	for i, g := range fd.glyphs {
		if i > 0 {
			glyphSIDs[i] = sid(g.name)
		}
	}

	charstrings := make([][]byte, len(fd.glyphs))
	for i, g := range fd.glyphs {
		charstrings[i] = charstring(g)
	}

	private := &writer{}
	writeBlues(private, fd.info)
	dictInt(private, 0)
	private.u8(20) // defaultWidthX
	dictInt(private, 0)
	private.u8(21) // nominalWidthX

	charset := &writer{}
	charset.u8(0)
	for _, s := range glyphSIDs[1:] {
		charset.u16(uint16(s))
	}

	topDict := func(charsetOff, csOff, privOff int) []byte {
		w := &writer{}
		dictInt(w, fullSID)
		w.u8(2)
		dictInt(w, familySID)
		w.u8(3)
		b := fd.bbox
		for _, v := range []float64{b.minX, b.minY, b.maxX, b.maxY} {
			dictInt(w, int(v))
		}
		w.u8(5)
		if upm := fd.info.UnitsPerEm; upm != 1000 {
			s := 1 / float64(upm)
			for _, v := range []float64{s, 0, 0, s, 0, 0} {
				dictReal(w, v)
			}
			w.u8(12)
			w.u8(7)
		}
		dictInt5(w, charsetOff)
		w.u8(15)
		dictInt5(w, csOff)
		w.u8(17)
		dictInt5(w, len(private.buf))
		dictInt5(w, privOff)
		w.u8(18)
		return w.buf
	}

	header := []byte{1, 0, 4, 4}
	nameIdx := index([][]byte{[]byte(fd.names.ps)})
	strData := make([][]byte, len(strs))
	for i, s := range strs {
		strData[i] = []byte(s)
	}
	strIdx := index(strData)
	gsubrIdx := index(nil)
	csIdx := index(charstrings)

	// The top DICT uses fixed-size offsets, so its length is known up front.
	topLen := len(index([][]byte{topDict(0, 0, 0)}))
	charsetOff := len(header) + len(nameIdx) + topLen + len(strIdx) + len(gsubrIdx)
	csOff := charsetOff + len(charset.buf)
	privOff := csOff + len(csIdx)
	topIdx := index([][]byte{topDict(charsetOff, csOff, privOff)})

	out := &writer{}
	out.bytes(header)
	out.bytes(nameIdx)
	out.bytes(topIdx)
	out.bytes(strIdx)
	out.bytes(gsubrIdx)
	out.bytes(charset.buf)
	out.bytes(csIdx)
	out.bytes(private.buf)
	return out.buf
}

func charstring(g glyphData) []byte {
	w := &writer{}
	if g.advance != 0 {
		csInt(w, g.advance)
	}
	cx, cy := 0, 0
	to := func(x, y float64) (int, int) {
		ix, iy := int(math.Round(x)), int(math.Round(y))
		dx, dy := ix-cx, iy-cy
		cx, cy = ix, iy
		return dx, dy
	}
	for _, c := range g.contours {
		segs := segments(c)
		if len(segs) == 0 {
			continue
		}
		dx, dy := to(segs[0].p0.x, segs[0].p0.y)
		csInt(w, dx)
		csInt(w, dy)
		w.u8(21) // rmoveto
		for i, s := range segs {
			if s.line {
				if i == len(segs)-1 {
					break // closepath is implicit
				}
				dx, dy := to(s.p3.x, s.p3.y)
				csInt(w, dx)
				csInt(w, dy)
				w.u8(5) // rlineto
				continue
			}
			for _, p := range []vec{s.c1, s.c2, s.p3} {
				dx, dy := to(p.x, p.y)
				csInt(w, dx)
				csInt(w, dy)
			}
			w.u8(8) // rrcurveto
		}
	}
	w.u8(14) // endchar
	return w.buf
}

// index encodes a CFF INDEX structure.
func index(items [][]byte) []byte {
	w := &writer{}
	w.u16(uint16(len(items)))
	if len(items) == 0 {
		return w.buf
	}
	total := 1
	for _, it := range items {
		total += len(it)
	}
	offSize := 1
	for limit := 0xFF; total > limit; limit = limit<<8 | 0xFF {
		offSize++
	}
	w.u8(uint8(offSize))
	off := 1
	writeOff := func(v int) {
		for i := offSize - 1; i >= 0; i-- {
			w.u8(byte(v >> (8 * i)))
		}
	}
	writeOff(off)
	for _, it := range items {
		off += len(it)
		writeOff(off)
	}
	for _, it := range items {
		w.bytes(it)
	}
	return w.buf
}

func dictInt(w *writer, v int) {
	switch {
	case v >= -107 && v <= 107:
		w.u8(byte(v + 139))
	case v >= 108 && v <= 1131:
		v -= 108
		w.u8(byte(v>>8) + 247)
		w.u8(byte(v))
	case v >= -1131 && v <= -108:
		v = -v - 108
		w.u8(byte(v>>8) + 251)
		w.u8(byte(v))
	case v >= -32768 && v <= 32767:
		w.u8(28)
		w.u16(uint16(int16(v)))
	default:
		dictInt5(w, v)
	}
}

func dictInt5(w *writer, v int) {
	w.u8(29)
	w.u32(uint32(int32(v)))
}

func dictReal(w *writer, v float64) {
	s := strings.ToUpper(strconv.FormatFloat(v, 'g', 8, 64))
	var nib []byte
	for i := 0; i < len(s); i++ {
		switch c := s[i]; {
		case c >= '0' && c <= '9':
			nib = append(nib, c-'0')
		case c == '.':
			nib = append(nib, 0xa)
		case c == '-':
			nib = append(nib, 0xe)
		case c == 'E':
			if i+1 < len(s) && s[i+1] == '-' {
				nib = append(nib, 0xc)
				i++
			} else {
				nib = append(nib, 0xb)
				if i+1 < len(s) && s[i+1] == '+' {
					i++
				}
			}
		}
	}
	nib = append(nib, 0xf)
	if len(nib)%2 == 1 {
		nib = append(nib, 0xf)
	}
	w.u8(30)
	for i := 0; i < len(nib); i += 2 {
		w.u8(nib[i]<<4 | nib[i+1])
	}
}

func csInt(w *writer, v int) {
	switch {
	case v >= -107 && v <= 107:
		w.u8(byte(v + 139))
	case v >= 108 && v <= 1131:
		v -= 108
		w.u8(byte(v>>8) + 247)
		w.u8(byte(v))
	case v >= -1131 && v <= -108:
		v = -v - 108
		w.u8(byte(v>>8) + 251)
		w.u8(byte(v))
	default:
		w.u8(28)
		w.u16(uint16(int16(v)))
	}
}

// writeBlues puts the alignment zones into the Private DICT: BlueValues
// (the baseline zone and the zones above the x-height, cap height and
// ascender) and OtherBlues (below the descender), each as deltas.
// Overlapping zones (two lines at one height) are written once.
func writeBlues(w *writer, in project.Info) {
	o := in.Overshoot
	if o <= 0 || o > 100 {
		return
	}
	top := [][2]int{{-o, 0}, {in.XHeight, in.XHeight + o}, {in.CapHeight, in.CapHeight + o}, {in.Ascender, in.Ascender + o}}
	sort.Slice(top, func(i, j int) bool { return top[i][0] < top[j][0] })
	var blues []int
	last := math.MinInt
	for _, z := range top {
		if z[0] <= last {
			continue // overlaps the zone before
		}
		blues = append(blues, z[0], z[1])
		last = z[1]
	}
	put := func(vals []int, op byte) {
		prev := 0
		for _, v := range vals {
			dictInt(w, v-prev)
			prev = v
		}
		w.u8(op)
	}
	put(blues, 6) // BlueValues
	if d := in.Descender; d < -o {
		put([]int{d - o, d}, 7) // OtherBlues
	}
	if o >= 25 { // BlueScale × the tallest zone must stay under 1
		dictReal(w, 0.9/float64(o))
		w.u8(12)
		w.u8(9)
	}
}
