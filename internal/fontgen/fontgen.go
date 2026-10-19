// Package fontgen compiles a Spline project into an installable font file.
//
// Two flavours are supported:
//   - TTF: TrueType outlines (quadratic curves, 'glyf' table)
//   - OTF: PostScript outlines (cubic curves, 'CFF ' table)
package fontgen

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf16"

	"github.com/GeekFreak01/spline/internal/project"
)

// Format selects the outline flavour of the generated font.
type Format int

const (
	TTF Format = iota
	OTF
	WOFF // TrueType packed for the web (WOFF 1.0)
)

// ParseFormat converts "ttf" / "otf" to a Format.
func ParseFormat(s string) (Format, error) {
	switch strings.ToLower(s) {
	case "ttf", "truetype":
		return TTF, nil
	case "otf", "cff", "opentype":
		return OTF, nil
	case "woff":
		return WOFF, nil
	}
	return 0, fmt.Errorf("unknown font format %q", s)
}

// glyphData is a glyph prepared for writing.
type glyphData struct {
	name     string // PostScript glyph name
	unicode  int
	advance  int
	contours []project.Contour
	bbox     box // in rounded font units, empty glyph => zero box
	empty    bool
}

type fontData struct {
	info   project.Info
	glyphs []glyphData    // glyph 0 is .notdef
	gid    map[string]int // project glyph name -> glyph id
	kern   []kernPair
	calt   []caltRule
	ligs   []ligRule
	// anchors by glyph id (extended mode): mark, mkmk and curs.
	anchors map[int]glyphAnchors
	// forms: alternate glyphs named by suffix (a.sc, one.onum, ...).
	forms []formFeature
	names names
	bbox  box
	now   time.Time
}

// Build compiles the project into font bytes.
func Build(p *project.Project, f Format) ([]byte, error) {
	if err := p.Validate(); err != nil {
		return nil, err
	}
	if f == WOFF {
		ttf, err := Build(p, TTF)
		if err != nil {
			return nil, err
		}
		return toWOFF(ttf)
	}
	fd := prepare(p, f)
	if len(fd.glyphs) < 2 {
		return nil, errors.New("the font has no glyphs")
	}

	tables := map[string][]byte{
		"cmap": buildCmap(fd),
		"head": nil, // filled below, needs glyf
		"hhea": nil,
		"hmtx": buildHmtx(fd),
		"name": buildName(fd),
		"OS/2": buildOS2(fd),
		"post": buildPost(p.Info),
	}
	var sfntVersion uint32
	switch f {
	case TTF:
		glyf, loca, maxPts, maxCts := buildGlyf(fd)
		tables["glyf"] = glyf
		tables["loca"] = loca
		tables["maxp"] = buildMaxpTT(len(fd.glyphs), maxPts, maxCts)
		sfntVersion = 0x00010000
	case OTF:
		tables["CFF "] = buildCFF(fd)
		tables["maxp"] = buildMaxpCFF(len(fd.glyphs))
		sfntVersion = 0x4F54544F // 'OTTO'
	}
	gpos, err := buildGPOS(fd)
	if err != nil {
		return nil, err
	}
	if gpos != nil {
		tables["GPOS"] = gpos
	}
	if gdef := buildGDEF(fd); gdef != nil {
		tables["GDEF"] = gdef
	}
	if len(fd.kern) > 0 {
		if k := buildKern(fd.kern); k != nil {
			tables["kern"] = k
		}
	}
	gsub, err := buildGSUB(fd.calt, fd.ligs, fd.forms)
	if err != nil {
		return nil, err
	}
	if gsub != nil {
		tables["GSUB"] = gsub
	}
	tables["head"] = buildHead(fd)
	tables["hhea"] = buildHhea(fd)
	return assemble(sfntVersion, tables), nil
}

func prepare(p *project.Project, f Format) *fontData {
	fd := &fontData{info: p.Info, now: time.Now().UTC(), gid: map[string]int{}}
	fd.names = makeNames(p.Info)
	upm := float64(p.Info.UnitsPerEm)

	// .notdef: a simple box, required as glyph 0.
	w := math.Round(upm * 0.5)
	h := float64(p.Info.CapHeight)
	sq := func(x0, y0, x1, y1 float64) project.Contour {
		return project.Contour{Closed: true, Nodes: []project.Node{
			{X: x0, Y: y0}, {X: x1, Y: y0}, {X: x1, Y: y1}, {X: x0, Y: y1},
		}}
	}
	notdef := project.Glyph{Name: ".notdef", Advance: w + 100, Contours: []project.Contour{
		sq(50, 0, 50+w, h), sq(100, 50, w, h-50),
	}}

	// Letters that were not drawn yet are left out, so apps fall back to
	// another font instead of showing an empty gap. Spaces stay.
	src := []project.Glyph{notdef}
	for _, g := range p.Glyphs {
		if g.NoExport {
			continue
		}
		if len(g.Outline()) > 0 || (g.Unicode > 0 && unicode.IsSpace(rune(g.Unicode))) {
			src = append(src, g)
		}
	}
	usedNames := map[string]bool{}
	for i, g := range src {
		gd := glyphData{
			unicode: g.Unicode,
			advance: int(math.Round(g.Advance)),
		}
		if i == 0 {
			gd.name = ".notdef"
		} else {
			gd.name = psGlyphName(g, i, usedNames)
		}
		usedNames[gd.name] = true
		if i > 0 {
			fd.gid[g.Name] = len(fd.glyphs)
		}
		if f == TTF {
			gd.contours = normalize(g.Outline(), false)
		} else {
			gd.contours = normalize(g.Outline(), true)
		}
		gd.contours = roundContours(gd.contours)
		gd.bbox, gd.empty = contoursBox(gd.contours, f)
		fd.glyphs = append(fd.glyphs, gd)
	}
	first := true
	for _, g := range fd.glyphs {
		if g.empty {
			continue
		}
		if first {
			fd.bbox = g.bbox
			first = false
			continue
		}
		fd.bbox.minX = math.Min(fd.bbox.minX, g.bbox.minX)
		fd.bbox.minY = math.Min(fd.bbox.minY, g.bbox.minY)
		fd.bbox.maxX = math.Max(fd.bbox.maxX, g.bbox.maxX)
		fd.bbox.maxY = math.Max(fd.bbox.maxY, g.bbox.maxY)
	}
	fd.kern = collectKerning(p, fd.gid)
	fd.calt, fd.ligs = collectSubst(p, fd.gid)
	fd.anchors = collectAnchors(p, fd.gid)
	fd.forms = collectForms(p, fd.gid)
	return fd
}

func roundContours(cs []project.Contour) []project.Contour {
	r := func(p *project.Point) *project.Point {
		if p == nil {
			return nil
		}
		return &project.Point{X: math.Round(p.X), Y: math.Round(p.Y)}
	}
	out := make([]project.Contour, len(cs))
	for i, c := range cs {
		nc := project.Contour{Closed: true, Nodes: make([]project.Node, len(c.Nodes))}
		for j, n := range c.Nodes {
			nc.Nodes[j] = project.Node{X: math.Round(n.X), Y: math.Round(n.Y), In: r(n.In), Out: r(n.Out)}
		}
		out[i] = nc
	}
	return out
}

// contoursBox returns the bounding box of the outline points. For TrueType
// this must match the quadratic points written to 'glyf'.
func contoursBox(cs []project.Contour, f Format) (box, bool) {
	var pts []vec
	if f == TTF {
		for _, c := range cs {
			for _, p := range ttContour(c) {
				pts = append(pts, vec{float64(p.x), float64(p.y)})
			}
		}
	} else {
		for _, c := range cs {
			for _, n := range c.Nodes {
				pts = append(pts, vec{n.X, n.Y})
				if n.In != nil {
					pts = append(pts, vec{n.In.X, n.In.Y})
				}
				if n.Out != nil {
					pts = append(pts, vec{n.Out.X, n.Out.Y})
				}
			}
		}
	}
	if len(pts) == 0 {
		return box{}, true
	}
	return polyBox(pts), false
}

func psGlyphName(g project.Glyph, idx int, used map[string]bool) string {
	ok := g.Name != "" && len(g.Name) <= 31 && g.Name[0] != '.' && (g.Name[0] < '0' || g.Name[0] > '9')
	for _, r := range g.Name {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '.' || r == '_') {
			ok = false
			break
		}
	}
	name := g.Name
	if !ok {
		switch {
		case g.Unicode > 0 && g.Unicode <= 0xFFFF:
			name = fmt.Sprintf("uni%04X", g.Unicode)
		case g.Unicode > 0xFFFF:
			name = fmt.Sprintf("u%05X", g.Unicode)
		default:
			name = fmt.Sprintf("glyph%d", idx)
		}
	}
	for base, k := name, 1; used[name]; k++ {
		name = fmt.Sprintf("%s.%d", base, k)
	}
	return name
}

// ---------------------------------------------------------------- names

type names struct {
	family, style, full, ps, unique, version string
	typoFamily, typoStyle                    string // set when style is not R/I/B/BI
}

func makeNames(in project.Info) names {
	n := names{family: in.FamilyName, style: in.StyleName}
	switch strings.ToLower(in.StyleName) {
	case "regular", "bold", "italic", "bold italic":
	default:
		n.typoFamily, n.typoStyle = n.family, n.style
		n.family = n.family + " " + n.style
		n.style = "Regular"
	}
	n.full = in.FamilyName + " " + in.StyleName
	n.version = "Version " + in.Version
	n.ps = psName(in.FamilyName) + "-" + psName(in.StyleName)
	n.unique = in.Version + ";SPLN;" + n.ps
	return n
}

// psName keeps only characters allowed in PostScript names. Cyrillic and
// Latin letters with accents are spelled in plain Latin, so "Мой шрифт"
// becomes "Moyshrift" rather than nothing.
func psName(s string) string {
	var b strings.Builder
	for _, r := range s {
		if t, ok := translit[unicode.ToLower(r)]; ok {
			if unicode.IsUpper(r) && t != "" {
				t = strings.ToUpper(t[:1]) + t[1:]
			}
			b.WriteString(t)
			continue
		}
		if r > 32 && r < 127 && !strings.ContainsRune("[](){}<>/% ", r) {
			b.WriteRune(r)
		}
	}
	out := b.String()
	if out == "" {
		out = "SplineFont"
	}
	if len(out) > 29 {
		out = out[:29]
	}
	return out
}

// FullName is the name the system shows for the font, e.g. in the list of
// installed fonts.
func FullName(in project.Info) string { return makeNames(in).full }

// PostScriptName is the font's ASCII name, also usable as a file name.
func PostScriptName(in project.Info) string { return makeNames(in).ps }

var translit = func() map[rune]string {
	m := map[rune]string{}
	cyr := "а:a б:b в:v г:g д:d е:e ё:yo ж:zh з:z и:i й:y к:k л:l м:m н:n о:o п:p р:r с:s т:t у:u ф:f х:kh ц:ts ч:ch ш:sh щ:shch ъ: ы:y ь: э:e ю:yu я:ya " +
		"і:i ї:yi є:ye ґ:g ў:u ә:a ғ:gh қ:q ң:ng ө:o ұ:u ү:u һ:h " +
		"à:a á:a â:a ã:a ä:a å:a æ:ae ç:c è:e é:e ê:e ë:e ì:i í:i î:i ï:i ñ:n ò:o ó:o ô:o õ:o ö:o ø:o ù:u ú:u û:u ü:u ý:y ÿ:y ß:ss ğ:g ı:i ş:s"
	for _, pair := range strings.Fields(cyr) {
		k, v, _ := strings.Cut(pair, ":")
		m[[]rune(k)[0]] = v
	}
	return m
}()

func buildName(fd *fontData) []byte {
	n := fd.names
	type rec struct {
		id  uint16
		val string
	}
	recs := []rec{
		{1, n.family}, {2, n.style}, {3, n.unique}, {4, n.full},
		{5, n.version}, {6, n.ps},
	}
	in := fd.info
	opt := func(id uint16, v string) {
		if v != "" {
			recs = append(recs, rec{id, v})
		}
	}
	opt(0, in.Copyright)
	opt(7, in.Trademark)
	opt(8, in.Manufacturer)
	opt(9, in.Designer)
	opt(10, in.Description)
	if in.VendorURL != "" {
		recs = append(recs, rec{11, in.VendorURL})
	} else {
		recs = append(recs, rec{11, "https://github.com/GeekFreak01/spline"})
	}
	opt(13, in.License)
	opt(14, in.LicenseURL)
	if n.typoFamily != "" {
		recs = append(recs, rec{16, n.typoFamily}, rec{17, n.typoStyle})
	}
	sort.Slice(recs, func(i, j int) bool { return recs[i].id < recs[j].id })

	var storage []byte
	w := &writer{}
	w.u16(0)
	w.u16(uint16(len(recs)))
	w.u16(uint16(6 + 12*len(recs)))
	for _, r := range recs {
		enc := utf16.Encode([]rune(r.val))
		data := make([]byte, 0, len(enc)*2)
		for _, c := range enc {
			data = append(data, byte(c>>8), byte(c))
		}
		w.u16(3)      // Windows
		w.u16(1)      // Unicode BMP
		w.u16(0x0409) // en-US
		w.u16(r.id)
		w.u16(uint16(len(data)))
		w.u16(uint16(len(storage)))
		storage = append(storage, data...)
	}
	w.bytes(storage)
	return w.buf
}

// ---------------------------------------------------------------- cmap

func buildCmap(fd *fontData) []byte {
	type m struct {
		code int
		gid  int
	}
	var bmp, all []m
	for gid, g := range fd.glyphs {
		if g.unicode > 0 {
			all = append(all, m{g.unicode, gid})
			if g.unicode <= 0xFFFF {
				bmp = append(bmp, m{g.unicode, gid})
			}
		}
	}
	sort.Slice(bmp, func(i, j int) bool { return bmp[i].code < bmp[j].code })
	sort.Slice(all, func(i, j int) bool { return all[i].code < all[j].code })

	// Format 4: segments of consecutive codes with consecutive glyph ids.
	type seg struct{ start, end, delta int }
	var segs []seg
	for _, e := range bmp {
		if l := len(segs); l > 0 && segs[l-1].end+1 == e.code && segs[l-1].delta == e.gid-e.code {
			segs[l-1].end = e.code
			continue
		}
		segs = append(segs, seg{e.code, e.code, e.gid - e.code})
	}
	segs = append(segs, seg{0xFFFF, 0xFFFF, 1})
	segCount := len(segs)
	pow := 1
	log := 0
	for pow*2 <= segCount {
		pow *= 2
		log++
	}
	f4 := &writer{}
	f4.u16(4)
	f4.u16(uint16(16 + 8*segCount))
	f4.u16(0)
	f4.u16(uint16(segCount * 2))
	f4.u16(uint16(pow * 2))
	f4.u16(uint16(log))
	f4.u16(uint16(segCount*2 - pow*2))
	for _, s := range segs {
		f4.u16(uint16(s.end))
	}
	f4.u16(0)
	for _, s := range segs {
		f4.u16(uint16(s.start))
	}
	for _, s := range segs {
		f4.u16(uint16(s.delta & 0xFFFF))
	}
	for range segs {
		f4.u16(0)
	}

	// Format 12 covers characters outside the BMP (emoji etc.).
	f12 := &writer{}
	type group struct{ start, end, gid int }
	var groups []group
	for _, e := range all {
		if l := len(groups); l > 0 && groups[l-1].end+1 == e.code && groups[l-1].gid+(e.code-groups[l-1].start) == e.gid {
			groups[l-1].end = e.code
			continue
		}
		groups = append(groups, group{e.code, e.code, e.gid})
	}
	f12.u16(12)
	f12.u16(0)
	f12.u32(uint32(16 + 12*len(groups)))
	f12.u32(0)
	f12.u32(uint32(len(groups)))
	for _, g := range groups {
		f12.u32(uint32(g.start))
		f12.u32(uint32(g.end))
		f12.u32(uint32(g.gid))
	}

	w := &writer{}
	w.u16(0)
	w.u16(3)
	off4 := uint32(4 + 8*3)
	off12 := off4 + uint32(len(f4.buf))
	w.u16(0)
	w.u16(3)
	w.u32(off4) // Unicode BMP
	w.u16(3)
	w.u16(1)
	w.u32(off4) // Windows BMP
	w.u16(3)
	w.u16(10)
	w.u32(off12) // Windows full repertoire
	w.bytes(f4.buf)
	w.bytes(f12.buf)
	return w.buf
}

// ---------------------------------------------------------------- metrics

func buildHmtx(fd *fontData) []byte {
	w := &writer{}
	for _, g := range fd.glyphs {
		w.u16(uint16(g.advance))
		w.i16(int16(g.bbox.minX))
	}
	return w.buf
}

func buildHhea(fd *fontData) []byte {
	advMax, minLSB, minRSB, maxExt := 0, math.MaxInt32, math.MaxInt32, math.MinInt32
	for _, g := range fd.glyphs {
		if g.advance > advMax {
			advMax = g.advance
		}
		if g.empty {
			continue
		}
		lsb := int(g.bbox.minX)
		rsb := g.advance - int(g.bbox.maxX)
		minLSB = min(minLSB, lsb)
		minRSB = min(minRSB, rsb)
		maxExt = max(maxExt, int(g.bbox.maxX))
	}
	if minLSB == math.MaxInt32 {
		minLSB, minRSB, maxExt = 0, 0, 0
	}
	w := &writer{}
	w.u32(0x00010000)
	w.i16(int16(fd.info.Ascender))
	w.i16(int16(fd.info.Descender))
	w.i16(int16(fd.info.LineGap))
	w.u16(uint16(advMax))
	w.i16(int16(minLSB))
	w.i16(int16(minRSB))
	w.i16(int16(maxExt))
	// The caret leans with italics: rise / run.
	rise, run := 1000, 0
	if a := fd.info.ItalicAngle; a != 0 {
		run = int(math.Round(-1000 * math.Tan(a*math.Pi/180)))
	}
	w.i16(int16(rise))
	w.i16(int16(run))
	w.i16(0)
	for i := 0; i < 5; i++ {
		w.i16(0)
	}
	w.u16(uint16(len(fd.glyphs)))
	return w.buf
}

func buildHead(fd *fontData) []byte {
	w := &writer{}
	w.u32(0x00010000)
	w.u32(fixedVersion(fd.info.Version))
	w.u32(0) // checkSumAdjustment, patched in assemble
	w.u32(0x5F0F3CF5)
	w.u16(0x000B) // baseline at y=0, lsb at x=0, integer scaling
	w.u16(uint16(fd.info.UnitsPerEm))
	date := uint64(fd.now.Unix() + 2082844800)
	w.u32(uint32(date >> 32))
	w.u32(uint32(date))
	w.u32(uint32(date >> 32))
	w.u32(uint32(date))
	w.i16(int16(fd.bbox.minX))
	w.i16(int16(fd.bbox.minY))
	w.i16(int16(fd.bbox.maxX))
	w.i16(int16(fd.bbox.maxY))
	w.u16(macStyle(fd.info)) // macStyle
	w.u16(8)                 // lowestRecPPEM
	w.i16(2)                 // fontDirectionHint
	w.i16(1)                 // long loca
	w.i16(0)
	return w.buf
}

func fixedVersion(v string) uint32 {
	var major, minor int
	fmt.Sscanf(v, "%d.%d", &major, &minor)
	frac := 0.0
	if i := strings.IndexByte(v, '.'); i >= 0 {
		fmt.Sscanf("0"+v[i:], "%g", &frac)
	}
	return uint32(major)<<16 | uint32(frac*65536)&0xFFFF
}

func buildMaxpTT(numGlyphs, maxPoints, maxContours int) []byte {
	w := &writer{}
	w.u32(0x00010000)
	w.u16(uint16(numGlyphs))
	w.u16(uint16(maxPoints))
	w.u16(uint16(maxContours))
	w.u16(0) // maxCompositePoints
	w.u16(0) // maxCompositeContours
	w.u16(2) // maxZones
	for i := 0; i < 8; i++ {
		w.u16(0)
	}
	return w.buf
}

func buildMaxpCFF(numGlyphs int) []byte {
	w := &writer{}
	w.u32(0x00005000)
	w.u16(uint16(numGlyphs))
	return w.buf
}

func buildPost(in project.Info) []byte {
	w := &writer{}
	w.u32(0x00030000)
	w.u32(uint32(int32(math.Round(in.ItalicAngle * 65536))))
	pos, th := in.UnderlinePos, in.UnderlineW
	if pos == 0 {
		pos = -in.UnitsPerEm / 10
	}
	if th <= 0 {
		th = in.UnitsPerEm / 20
	}
	w.i16(int16(pos))
	w.i16(int16(th))
	for i := 0; i < 5; i++ {
		w.u32(0)
	}
	return w.buf
}

func buildOS2(fd *fontData) []byte {
	in := fd.info
	sum, cnt := 0, 0
	first, last := 0xFFFF, 0
	var ur [4]uint32
	var cp [2]uint32
	for _, g := range fd.glyphs {
		if g.advance > 0 {
			sum += g.advance
			cnt++
		}
		u := g.unicode
		if u <= 0 {
			continue
		}
		first = min(first, u)
		last = max(last, u)
		switch {
		case u < 0x80:
			ur[0] |= 1 << 0
			cp[0] |= 1 << 0
		case u < 0x100:
			ur[0] |= 1 << 1
			cp[0] |= 1 << 0
		case u < 0x180:
			ur[0] |= 1 << 2
			cp[0] |= 1 << 1
		case u >= 0x370 && u < 0x400:
			ur[0] |= 1 << 7
			cp[0] |= 1 << 3
		case u >= 0x400 && u < 0x530:
			ur[0] |= 1 << 9
			cp[0] |= 1 << 2
		case u > 0xFFFF:
			ur[1] |= 1 << 25
		}
	}
	if cp[0] == 0 {
		cp[0] = 1
	}
	avg := 0
	if cnt > 0 {
		avg = sum / cnt
	}
	if last > 0xFFFF {
		last = 0xFFFF
	}
	if first > last {
		first, last = 0, 0
	}
	upm := in.UnitsPerEm
	winAscent := max(in.Ascender, int(fd.bbox.maxY))
	winDescent := max(-in.Descender, -int(fd.bbox.minY))

	w := &writer{}
	w.u16(4)
	w.i16(int16(avg))
	w.u16(uint16(weightOf(in))) // weight
	w.u16(5)                    // width
	w.u16(0)                    // fsType: installable
	w.i16(int16(upm * 65 / 100))
	w.i16(int16(upm * 60 / 100))
	w.i16(0)
	w.i16(int16(upm * 7 / 100))
	w.i16(int16(upm * 65 / 100))
	w.i16(int16(upm * 60 / 100))
	w.i16(0)
	w.i16(int16(upm * 48 / 100))
	w.i16(int16(upm * 5 / 100))
	w.i16(int16(upm * 26 / 100))
	w.i16(0) // sFamilyClass
	w.bytes(make([]byte, 10))
	for _, r := range ur {
		w.u32(r)
	}
	w.bytes([]byte("SPLN"))
	w.u16(fsSelection(in))
	w.u16(uint16(first))
	w.u16(uint16(last))
	w.i16(int16(in.Ascender))
	w.i16(int16(in.Descender))
	w.i16(int16(in.LineGap))
	w.u16(uint16(winAscent))
	w.u16(uint16(winDescent))
	w.u32(cp[0])
	w.u32(cp[1])
	w.i16(int16(in.XHeight))
	w.i16(int16(in.CapHeight))
	w.u16(0)
	w.u16(32)
	w.u16(0)
	return w.buf
}

func weightOf(in project.Info) int {
	if in.Weight == 0 {
		if strings.Contains(strings.ToLower(in.StyleName), "bold") {
			return 700
		}
		return 400
	}
	return in.Weight
}

func isItalic(in project.Info) bool {
	st := strings.ToLower(in.StyleName)
	return in.ItalicAngle != 0 || strings.Contains(st, "italic") || strings.Contains(st, "oblique")
}

// fsSelection: ITALIC, BOLD or REGULAR, and USE_TYPO_METRICS.
func fsSelection(in project.Info) uint16 {
	var v uint16 = 0x80
	if isItalic(in) {
		v |= 0x01
	}
	if weightOf(in) >= 700 {
		v |= 0x20
	}
	if v&0x21 == 0 {
		v |= 0x40
	}
	return v
}

func macStyle(in project.Info) uint16 {
	var v uint16
	if weightOf(in) >= 700 {
		v |= 1
	}
	if isItalic(in) {
		v |= 2
	}
	return v
}
