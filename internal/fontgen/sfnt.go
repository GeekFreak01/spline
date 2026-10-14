package fontgen

import "sort"

// writer is a tiny big-endian byte buffer.
type writer struct{ buf []byte }

func (w *writer) u8(v uint8)     { w.buf = append(w.buf, v) }
func (w *writer) u16(v uint16)   { w.buf = append(w.buf, byte(v>>8), byte(v)) }
func (w *writer) i16(v int16)    { w.u16(uint16(v)) }
func (w *writer) u32(v uint32)   { w.buf = append(w.buf, byte(v>>24), byte(v>>16), byte(v>>8), byte(v)) }
func (w *writer) bytes(b []byte) { w.buf = append(w.buf, b...) }
func (w *writer) pad4() {
	for len(w.buf)%4 != 0 {
		w.buf = append(w.buf, 0)
	}
}

func checksum(b []byte) uint32 {
	var sum uint32
	for i := 0; i < len(b); i += 4 {
		var v uint32
		for j := 0; j < 4; j++ {
			v <<= 8
			if i+j < len(b) {
				v |= uint32(b[i+j])
			}
		}
		sum += v
	}
	return sum
}

// assemble writes the table directory and all tables, then patches the
// checkSumAdjustment field of the 'head' table.
func assemble(sfntVersion uint32, tables map[string][]byte) []byte {
	tags := make([]string, 0, len(tables))
	for t := range tables {
		tags = append(tags, t)
	}
	sort.Strings(tags)

	n := len(tags)
	pow, log := 1, 0
	for pow*2 <= n {
		pow *= 2
		log++
	}
	w := &writer{}
	w.u32(sfntVersion)
	w.u16(uint16(n))
	w.u16(uint16(pow * 16))
	w.u16(uint16(log))
	w.u16(uint16(n*16 - pow*16))

	offset := 12 + 16*n
	headOffset := 0
	for _, t := range tags {
		data := tables[t]
		w.bytes([]byte(t))
		w.u32(checksum(data))
		w.u32(uint32(offset))
		w.u32(uint32(len(data)))
		if t == "head" {
			headOffset = offset
		}
		offset += (len(data) + 3) &^ 3
	}
	for _, t := range tags {
		w.bytes(tables[t])
		w.pad4()
	}
	adj := 0xB1B0AFBA - checksum(w.buf)
	b := w.buf[headOffset+8:]
	b[0], b[1], b[2], b[3] = byte(adj>>24), byte(adj>>16), byte(adj>>8), byte(adj)
	return w.buf
}
