package fontgen

import (
	"sort"
	"strings"
	"unicode"

	"github.com/GeekFreak01/spline/internal/project"
)

// Special forms (extended mode): a glyph named "base.suffix" is an
// alternate form of "base" that an OpenType feature switches on, the way
// Glyphs does it:
//
//	a.sc        small caps (smcp; and c2sc for capitals)
//	A.case      for all-caps text (case)
//	one.onum    old-style figures, .lnum lining, .tnum tabular, .pnum proportional
//	two.sups    superscript (sups), .subs/.sinf subscript, .numr/.dnom fractions
//	g.ss01      stylistic set 1..20, .cv01 character variant, .salt, .swsh
//	zero.zero   slashed zero, .ordn ordinals
//	be.loclBGR  Bulgarian form (locl for the BGR language); SRB, MKD, UKR...
type formFeature struct {
	tag   string
	lang  string // OpenType language tag for locl, "" = every language
	subst map[int]int
}

var suffixFeature = map[string]string{
	"case": "case", "onum": "onum", "lnum": "lnum", "tnum": "tnum", "pnum": "pnum",
	"sups": "sups", "subs": "subs", "sinf": "sinf", "numr": "numr", "dnom": "dnom",
	"salt": "salt", "swsh": "swsh", "ordn": "ordn", "zero": "zero", "sc": "smcp",
}

// featureForSuffix returns the feature tag and language for a suffix.
func featureForSuffix(suf string) (tag, lang string, ok bool) {
	if t, ok := suffixFeature[suf]; ok {
		return t, "", true
	}
	if len(suf) == 4 && (strings.HasPrefix(suf, "ss") || strings.HasPrefix(suf, "cv")) && isDigits(suf[2:]) {
		if suf[:2] == "ss" && (suf[2:] == "00" || suf[2:] > "20") {
			return "", "", false
		}
		return suf, "", true
	}
	if strings.HasPrefix(suf, "locl") && len(suf) >= 7 && len(suf) <= 8 {
		lang := strings.ToUpper(suf[4:])
		for len(lang) < 4 {
			lang += " "
		}
		return "locl", lang, true
	}
	return "", "", false
}

func isDigits(s string) bool {
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return s != ""
}

func collectForms(p *project.Project, gid map[string]int) []formFeature {
	byName := map[string]*project.Glyph{}
	byChar := map[rune]*project.Glyph{}
	for i := range p.Glyphs {
		g := &p.Glyphs[i]
		byName[g.Name] = g
		if g.Unicode > 0 {
			byChar[rune(g.Unicode)] = g
		}
	}
	feats := map[string]*formFeature{} // by tag + lang
	add := func(tag, lang string, from, to int) {
		k := tag + "|" + lang
		f := feats[k]
		if f == nil {
			f = &formFeature{tag: tag, lang: lang, subst: map[int]int{}}
			feats[k] = f
		}
		if _, dup := f.subst[from]; !dup {
			f.subst[from] = to
		}
	}
	for _, g := range p.Glyphs {
		i := strings.LastIndexByte(g.Name, '.')
		if i <= 0 {
			continue
		}
		base, suf := g.Name[:i], g.Name[i+1:]
		to, ok1 := gid[g.Name]
		from, ok2 := gid[base]
		if !ok1 || !ok2 {
			continue
		}
		tag, lang, ok := featureForSuffix(suf)
		if !ok {
			continue
		}
		if tag == "smcp" {
			// a.sc is small caps for "a"; A.sc (or a.sc when there is no
			// A.sc) is what capitals become in c2sc.
			if bg := byName[base]; bg != nil && bg.Unicode > 0 {
				r := rune(bg.Unicode)
				if unicode.IsUpper(r) {
					add("c2sc", "", from, to)
					continue
				}
				if up := byChar[unicode.ToUpper(r)]; up != nil && up.Name != base {
					if uid, ok := gid[up.Name]; ok {
						if _, own := gid[up.Name+".sc"]; !own {
							add("c2sc", "", uid, to)
						}
					}
				}
			}
		}
		add(tag, lang, from, to)
	}
	var out []formFeature
	for _, f := range feats {
		out = append(out, *f)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].tag != out[j].tag {
			return out[i].tag < out[j].tag
		}
		return out[i].lang < out[j].lang
	})
	return out
}

// fracRule: what the frac feature needs. With it on, "1/2" turns into a
// numerator, a fraction slash and a denominator: every figure becomes its
// .numr form, the slash becomes the fraction slash (U+2044, when the font
// has one) and a numerator right after the slash or a denominator becomes
// a denominator.
type fracRule struct {
	numr, dnom map[int]int // figure -> its numerator / denominator form
	slash      int         // "/" (0 = none)
	fraction   int         // U+2044 (0 = none)
}

// collectFrac returns the frac rule, or nil when the font lacks the forms.
func collectFrac(p *project.Project, gid map[string]int, forms []formFeature) *fracRule {
	r := &fracRule{}
	for _, f := range forms {
		if f.lang != "" {
			continue
		}
		switch f.tag {
		case "numr":
			r.numr = f.subst
		case "dnom":
			r.dnom = f.subst
		}
	}
	for _, g := range p.Glyphs {
		switch g.Unicode {
		case '/':
			r.slash = gid[g.Name]
		case 0x2044:
			r.fraction = gid[g.Name]
		}
	}
	if len(r.numr) == 0 || len(r.dnom) == 0 || (r.slash == 0 && r.fraction == 0) {
		return nil
	}
	for fig := range r.numr {
		if _, ok := r.dnom[fig]; ok {
			return r
		}
	}
	return nil
}

// singleMapLookup writes a SingleSubst format 2 lookup.
func singleMapLookup(m map[int]int) []byte {
	ids := make([]int, 0, len(m))
	for k := range m {
		ids = append(ids, k)
	}
	sort.Ints(ids)
	cov := coverage(ids)
	sub := &writer{}
	sub.u16(2)
	sub.u16(uint16(6 + 2*len(ids)))
	sub.u16(uint16(len(ids)))
	for _, id := range ids {
		sub.u16(uint16(m[id]))
	}
	sub.bytes(cov)
	return lookupTable(1, sub.buf)
}
