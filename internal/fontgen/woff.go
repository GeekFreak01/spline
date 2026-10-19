package fontgen

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"errors"
)

// toWOFF packs an sfnt (TTF/OTF) into WOFF 1.0: the same tables, each
// zlib-compressed when that makes it smaller. Every browser reads it.
func toWOFF(sfnt []byte) ([]byte, error) {
	if len(sfnt) < 12 {
		return nil, errors.New("bad font")
	}
	be := binary.BigEndian
	flavor := be.Uint32(sfnt)
	n := int(be.Uint16(sfnt[4:]))
	if len(sfnt) < 12+16*n {
		return nil, errors.New("bad font")
	}
	type table struct {
		tag        [4]byte
		checksum   uint32
		orig, data []byte
	}
	tables := make([]table, n)
	total := 12 + 16*n
	for i := range tables {
		e := sfnt[12+16*i:]
		off, length := int(be.Uint32(e[8:])), int(be.Uint32(e[12:]))
		if off+length > len(sfnt) {
			return nil, errors.New("bad font")
		}
		t := &tables[i]
		copy(t.tag[:], e[:4])
		t.checksum = be.Uint32(e[4:])
		t.orig = sfnt[off : off+length]
		var z bytes.Buffer
		zw, _ := zlib.NewWriterLevel(&z, zlib.BestCompression)
		zw.Write(t.orig)
		zw.Close()
		if z.Len() < len(t.orig) {
			t.data = z.Bytes()
		} else {
			t.data = t.orig
		}
		total += (length + 3) &^ 3
	}
	w := &writer{}
	w.bytes([]byte("wOFF"))
	w.u32(flavor)
	w.u32(0) // length, patched below
	w.u16(uint16(n))
	w.u16(0)
	w.u32(uint32(total))
	w.u16(1) // font version 1.0
	w.u16(0)
	for i := 0; i < 5; i++ {
		w.u32(0) // no metadata, no private data
	}
	off := 44 + 20*n
	for _, t := range tables {
		w.bytes(t.tag[:])
		w.u32(uint32(off))
		w.u32(uint32(len(t.data)))
		w.u32(uint32(len(t.orig)))
		w.u32(t.checksum)
		off += (len(t.data) + 3) &^ 3
	}
	for _, t := range tables {
		w.bytes(t.data)
		for len(w.buf)%4 != 0 {
			w.buf = append(w.buf, 0)
		}
	}
	be.PutUint32(w.buf[8:], uint32(len(w.buf)))
	return w.buf, nil
}
