package fontgen

import (
	"bytes"
	"encoding/binary"
	"errors"

	"github.com/andybalholm/brotli"
)

// Tags with a one-byte code in the WOFF2 table directory.
var woff2Tags = []string{
	"cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT",
	"EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH",
	"CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
	"gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
}

// toWOFF2 packs an sfnt into WOFF 2.0: the tables as they are (the "null
// transform", glyf and loca included), one Brotli stream for all of them.
// About a third smaller than WOFF 1.0; every current browser reads it.
func toWOFF2(sfnt []byte) ([]byte, error) {
	if len(sfnt) < 12 {
		return nil, errors.New("bad font")
	}
	be := binary.BigEndian
	flavor := be.Uint32(sfnt)
	n := int(be.Uint16(sfnt[4:]))
	if len(sfnt) < 12+16*n {
		return nil, errors.New("bad font")
	}
	dir := &writer{}
	var stream bytes.Buffer
	total := 12 + 16*n
	for i := 0; i < n; i++ {
		e := sfnt[12+16*i:]
		tag := string(e[:4])
		off, length := int(be.Uint32(e[8:])), int(be.Uint32(e[12:]))
		if off+length > len(sfnt) {
			return nil, errors.New("bad font")
		}
		code := 63
		for k, t := range woff2Tags {
			if t == tag {
				code = k
				break
			}
		}
		flags := byte(code)
		if tag == "glyf" || tag == "loca" {
			flags |= 3 << 6 // null transform
		}
		dir.u8(flags)
		if code == 63 {
			dir.bytes(e[:4])
		}
		dir.bytes(base128(uint32(length)))
		stream.Write(sfnt[off : off+length])
		total += (length + 3) &^ 3
	}
	var z bytes.Buffer
	bw := brotli.NewWriterOptions(&z, brotli.WriterOptions{Quality: 11, LGWin: 22})
	if _, err := bw.Write(stream.Bytes()); err != nil {
		return nil, err
	}
	if err := bw.Close(); err != nil {
		return nil, err
	}
	w := &writer{}
	w.bytes([]byte("wOF2"))
	w.u32(flavor)
	w.u32(0) // length, patched below
	w.u16(uint16(n))
	w.u16(0)
	w.u32(uint32(total))
	w.u32(uint32(z.Len()))
	w.u16(1) // font version 1.0
	w.u16(0)
	for i := 0; i < 5; i++ {
		w.u32(0) // no metadata, no private data
	}
	w.bytes(dir.buf)
	w.bytes(z.Bytes())
	for len(w.buf)%4 != 0 {
		w.buf = append(w.buf, 0)
	}
	be.PutUint32(w.buf[8:], uint32(len(w.buf)))
	return w.buf, nil
}

// base128 is WOFF2's UIntBase128: 7 bits a byte, high bit set on all but the last.
func base128(v uint32) []byte {
	out := []byte{byte(v & 0x7F)}
	for v >>= 7; v > 0; v >>= 7 {
		out = append([]byte{byte(v&0x7F) | 0x80}, out...)
	}
	return out
}
