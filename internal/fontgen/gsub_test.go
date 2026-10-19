package fontgen

import (
	"encoding/binary"
	"reflect"
	"slices"
	"testing"

	"github.com/GeekFreak01/spline/internal/project"
)

// tableOf returns a table of a built font.
func tableOf(t *testing.T, font []byte, tag string) []byte {
	t.Helper()
	n := int(binary.BigEndian.Uint16(font[4:]))
	for i := 0; i < n; i++ {
		r := font[12+16*i:]
		if string(r[:4]) == tag {
			off, ln := binary.BigEndian.Uint32(r[8:]), binary.BigEndian.Uint32(r[12:])
			return font[off : off+ln]
		}
	}
	return nil
}

// shape applies the GSUB features of the default script to a glyph run.
// It understands exactly what buildGSUB writes, and reads every offset, so a
// broken table fails here.
// With `only`, just these features run.
func shape(t *testing.T, gsub []byte, run []int, only ...string) []int {
	t.Helper()
	u16 := func(b []byte, o int) int { return int(binary.BigEndian.Uint16(b[o:])) }
	covers := func(c []byte, g int) bool {
		if u16(c, 0) != 1 {
			t.Fatalf("coverage format %d", u16(c, 0))
		}
		for i := 0; i < u16(c, 2); i++ {
			if u16(c, 4+2*i) == g {
				return true
			}
		}
		return false
	}
	scripts, features, lookups := gsub[u16(gsub, 4):], gsub[u16(gsub, 6):], gsub[u16(gsub, 8):]
	lang := scripts[u16(scripts, 6):]
	lang = lang[u16(lang, 0):]
	sub := func(i int) (int, []byte) {
		l := lookups[u16(lookups, 2+2*i):]
		return u16(l, 0), l[u16(l, 6):]
	}
	out := append([]int(nil), run...)
	for f := 0; f < u16(lang, 4); f++ {
		rec := 2 + 6*u16(lang, 6+2*f)
		if len(only) > 0 && !slices.Contains(only, string(features[rec:rec+4])) {
			continue
		}
		feat := features[u16(features, rec+4):]
		for k := 0; k < u16(feat, 2); k++ {
			kind, st := sub(u16(feat, 4+2*k))
			switch kind {
			case 1: // format 2: coverage index -> substitute
				if u16(st, 0) != 2 {
					t.Fatalf("single subst format %d", u16(st, 0))
				}
				cov := st[u16(st, 2):]
				for i := range out {
					for c := 0; c < u16(cov, 2); c++ {
						if u16(cov, 4+2*c) == out[i] {
							out[i] = u16(st, 6+2*c)
							break
						}
					}
				}
			case 6:
				nb := u16(st, 2)
				inOff := 4 + 2*nb
				na := u16(st, inOff+4)
				rec := inOff + 6 + 2*na + 2
				for i := range out {
					ok := covers(st[u16(st, inOff+2):], out[i])
					if nb > 0 {
						ok = ok && i > 0 && covers(st[u16(st, 4):], out[i-1])
					}
					if na > 0 {
						ok = ok && i+1 < len(out) && covers(st[u16(st, inOff+6):], out[i+1])
					}
					if ok {
						_, single := sub(u16(st, rec+2))
						cov := single[u16(single, 2):]
						for c := 0; c < u16(cov, 2); c++ {
							if u16(cov, 4+2*c) == out[i] {
								out[i] = u16(single, 6+2*c)
								break
							}
						}
					}
				}
			case 4:
				cov := st[u16(st, 2):]
				var res []int
				for i := 0; i < len(out); i++ {
					matched := false
					for s := 0; s < u16(cov, 2) && !matched; s++ {
						if u16(cov, 4+2*s) != out[i] {
							continue
						}
						set := st[u16(st, 6+2*s):]
						for l := 0; l < u16(set, 0) && !matched; l++ {
							lig := set[u16(set, 2+2*l):]
							n := u16(lig, 2)
							if i+n > len(out) {
								continue
							}
							same := true
							for c := 1; c < n; c++ {
								same = same && out[i+c] == u16(lig, 2+2*c)
							}
							if same {
								res = append(res, u16(lig, 0))
								i += n - 1
								matched = true
							}
						}
					}
					if !matched {
						res = append(res, out[i])
					}
				}
				out = res
			default:
				t.Fatalf("unexpected lookup type %d", kind)
			}
		}
	}
	return out
}

func TestSubstitutions(t *testing.T) {
	p := testProject()
	h := p.Glyphs[1].Contours
	p.Glyphs = append(p.Glyphs,
		project.Glyph{Name: "O.alt", Advance: 700, Contours: h},
		project.Glyph{Name: "O.end", Advance: 700, Contours: h},
		project.Glyph{Name: "H_H", Advance: 1100, Contours: h},
		project.Glyph{Name: "H_H_H", Advance: 1600, Contours: h},
	)
	p.Contextual = []project.Alternate{
		{Glyph: "O", Use: "O.alt", Prev: []string{"H"}},     // O after H
		{Glyph: "O", Use: "O.end", Next: []string{"space"}}, // O before a space
		{Glyph: "Ж", Use: "missing", Next: []string{"H"}},   // skipped
	}
	p.Ligatures = []project.Ligature{
		{Glyphs: []string{"H", "H"}, Use: "H_H"},
		{Glyphs: []string{"H", "H", "H"}, Use: "H_H_H"},
	}
	for _, f := range []Format{TTF, OTF} {
		fd := prepare(p, f)
		data, err := Build(p, f)
		if err != nil {
			t.Fatal(err)
		}
		gsub := tableOf(t, data, "GSUB")
		if gsub == nil {
			t.Fatal("no GSUB table")
		}
		g := func(names ...string) []int {
			var ids []int
			for _, n := range names {
				ids = append(ids, fd.gid[n])
			}
			return ids
		}
		for _, c := range []struct{ in, want []string }{
			{[]string{"H", "O"}, []string{"H", "O.alt"}},
			{[]string{"O", "O"}, []string{"O", "O"}},
			{[]string{"O", "space"}, []string{"O.end", "space"}},
			{[]string{"Ж", "H"}, []string{"Ж", "H"}},
			{[]string{"H", "H", "H", "O"}, []string{"H_H_H", "O.alt"}},
			{[]string{"H", "H", "O"}, []string{"H_H", "O.alt"}},
		} {
			if got := shape(t, gsub, g(c.in...)); !reflect.DeepEqual(got, g(c.want...)) {
				t.Errorf("format %d: %v -> %v, want %v", f, c.in, got, g(c.want...))
			}
		}
	}
}

func TestFractions(t *testing.T) {
	p := testProject()
	h := p.Glyphs[1].Contours
	add := func(name string, u int) {
		p.Glyphs = append(p.Glyphs, project.Glyph{Name: name, Unicode: u, Advance: 500, Contours: h})
	}
	for i, n := range []string{"one", "two", "three"} {
		add(n, '1'+i)
		add(n+".numr", 0)
		add(n+".dnom", 0)
	}
	add("slash", '/')
	for _, withFraction := range []bool{false, true} {
		if withFraction {
			add("fraction", 0x2044)
		}
		fd := prepare(p, TTF)
		data, err := Build(p, TTF)
		if err != nil {
			t.Fatal(err)
		}
		g := func(names ...string) []int {
			var ids []int
			for _, n := range names {
				ids = append(ids, fd.gid[n])
			}
			return ids
		}
		div := "slash"
		if withFraction {
			div = "fraction"
		}
		gsub := tableOf(t, data, "GSUB")
		for _, c := range []struct{ in, want []string }{
			{[]string{"one", "slash", "two"}, []string{"one.numr", div, "two.dnom"}},
			{[]string{"one", "two", "slash", "three", "one"}, []string{"one.numr", "two.numr", div, "three.dnom", "one.dnom"}},
			{[]string{"H", "one", "slash", "two", "space", "three"}, []string{"H", "one.numr", div, "two.dnom", "space", "three.numr"}},
		} {
			if got := shape(t, gsub, g(c.in...), "frac"); !reflect.DeepEqual(got, g(c.want...)) {
				t.Errorf("fraction slash %v: %v -> %v, want %v", withFraction, c.in, got, g(c.want...))
			}
		}
	}
}
