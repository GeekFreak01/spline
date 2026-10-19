// Package ufo reads and writes UFO 3 fonts, the shared source format of
// Glyphs, FontLab, RoboFont and fontTools: a .ufoz (one zipped UFO) for a
// project without masters, or a .zip with a .designspace and one UFO per
// master.
package ufo

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode"

	"github.com/GeekFreak01/spline/internal/project"
)

// Export writes the project. It returns the archive and its file
// extension: "ufoz" without masters, "zip" (UFOs + .designspace) with them.
func Export(p *project.Project) ([]byte, string, error) {
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	family := safeName(p.Info.FamilyName, "Font")
	ext := "ufoz"
	if len(p.Masters) > 1 && p.Axis != nil {
		ext = "zip"
		var sources []string
		for i, m := range p.Masters {
			dir := fmt.Sprintf("%s-%s.ufo", family, safeName(m.Name, fmt.Sprintf("Master%d", i+1)))
			if err := writeUFO(z, dir, p, i); err != nil {
				return nil, "", err
			}
			sources = append(sources, dir)
		}
		w, err := z.Create(family + ".designspace")
		if err != nil {
			return nil, "", err
		}
		w.Write(designspace(p, sources))
	} else {
		dir := fmt.Sprintf("%s-%s.ufo", family, safeName(p.Info.StyleName, "Regular"))
		if err := writeUFO(z, dir, p, 0); err != nil {
			return nil, "", err
		}
	}
	if err := z.Close(); err != nil {
		return nil, "", err
	}
	return buf.Bytes(), ext, nil
}

// safeName is a name usable as a file name.
func safeName(s, fallback string) string {
	s = strings.Map(func(r rune) rune {
		if r < 32 || strings.ContainsRune(`\/:*?"<>|`, r) {
			return '_'
		}
		return r
	}, strings.TrimSpace(s))
	s = strings.ReplaceAll(s, " ", "")
	if s == "" {
		return fallback
	}
	return s
}

// writeUFO writes master mi of p (0 = the default) as the UFO dir.
func writeUFO(z *zip.Writer, dir string, p *project.Project, mi int) error {
	put := func(name string, data []byte) error {
		w, err := z.Create(dir + "/" + name)
		if err != nil {
			return err
		}
		_, err = w.Write(data)
		return err
	}
	if err := put("metainfo.plist", writePlist(map[string]any{"creator": "com.geekfreak.spline", "formatVersion": 3})); err != nil {
		return err
	}
	style := p.Info.StyleName
	weight := p.Info.Weight
	kerning := p.Kerning
	var masterID string
	if len(p.Masters) > 1 {
		m := p.Masters[mi]
		style, masterID = m.Name, m.ID
		if p.Axis != nil && strings.EqualFold(p.Axis.Tag, "wght") {
			weight = int(math.Round(m.Loc))
		}
		if mi > 0 && m.Kerning != nil {
			kerning = m.Kerning
		}
		if mi == 0 {
			masterID = ""
		}
	}
	if err := put("fontinfo.plist", writePlist(fontInfo(p.Info, style, weight))); err != nil {
		return err
	}

	// Kerning groups: public.kern1.X are first-side groups (the glyphs'
	// right sides), public.kern2.X second-side ones (left sides).
	groups := map[string]any{}
	add := func(prefix, name, glyph string) {
		if name == "" {
			return
		}
		k := prefix + name
		list, _ := groups[k].([]string)
		groups[k] = append(list, glyph)
	}
	for _, g := range p.Glyphs {
		add("public.kern1.", g.KernRight, g.Name)
		add("public.kern2.", g.KernLeft, g.Name)
	}
	if err := put("groups.plist", writePlist(groups)); err != nil {
		return err
	}
	kern := map[string]any{}
	side := func(k, prefix string) string {
		if strings.HasPrefix(k, "@") {
			return prefix + k[1:]
		}
		return k
	}
	for first, row := range kerning {
		r := map[string]any{}
		for second, v := range row {
			r[side(second, "public.kern2.")] = math.Round(v)
		}
		if len(r) > 0 {
			kern[side(first, "public.kern1.")] = r
		}
	}
	if err := put("kerning.plist", writePlist(kern)); err != nil {
		return err
	}

	var order, skip []string
	for _, g := range p.Glyphs {
		order = append(order, g.Name)
		if g.NoExport {
			skip = append(skip, g.Name)
		}
	}
	lib := map[string]any{"public.glyphOrder": order}
	if len(skip) > 0 {
		lib["public.skipExportGlyphs"] = skip
	}
	if err := put("lib.plist", writePlist(lib)); err != nil {
		return err
	}
	if err := put("layercontents.plist", writePlist([]any{[]string{"public.default", "glyphs"}})); err != nil {
		return err
	}

	contents := map[string]any{}
	used := map[string]bool{}
	for _, g := range p.Glyphs {
		file := glifFileName(g.Name, used)
		contents[g.Name] = file
		if err := put("glyphs/"+file, glif(g, masterID)); err != nil {
			return err
		}
	}
	return put("glyphs/contents.plist", writePlist(contents))
}

func fontInfo(in project.Info, style string, weight int) map[string]any {
	m := map[string]any{
		"familyName": in.FamilyName, "styleName": style,
		"unitsPerEm": in.UnitsPerEm, "ascender": in.Ascender, "descender": in.Descender,
		"xHeight": in.XHeight, "capHeight": in.CapHeight,
	}
	if v := strings.SplitN(in.Version, ".", 2); len(v) == 2 {
		if a, err := strconv.Atoi(v[0]); err == nil {
			m["versionMajor"] = a
		}
		if b, err := strconv.Atoi(v[1]); err == nil {
			m["versionMinor"] = b
		}
	}
	text := map[string]string{
		"copyright": in.Copyright, "trademark": in.Trademark,
		"openTypeNameDesigner": in.Designer, "openTypeNameManufacturer": in.Manufacturer,
		"openTypeNameManufacturerURL": in.VendorURL, "openTypeNameLicense": in.License,
		"openTypeNameLicenseURL": in.LicenseURL, "openTypeNameDescription": in.Description,
	}
	for k, v := range text {
		if v != "" {
			m[k] = v
		}
	}
	if weight > 0 {
		m["openTypeOS2WeightClass"] = weight
	}
	if in.ItalicAngle != 0 {
		m["italicAngle"] = in.ItalicAngle
	}
	if in.LineGap != 0 {
		m["openTypeHheaLineGap"] = in.LineGap
	}
	if in.UnderlinePos != 0 {
		m["postscriptUnderlinePosition"] = in.UnderlinePos
	}
	if in.UnderlineW != 0 {
		m["postscriptUnderlineThickness"] = in.UnderlineW
	}
	if o := in.Overshoot; o > 0 {
		m["postscriptBlueValues"] = []any{-o, 0, in.XHeight, in.XHeight + o, in.CapHeight, in.CapHeight + o, in.Ascender, in.Ascender + o}
		m["postscriptOtherBlues"] = []any{in.Descender - o, in.Descender}
	}
	return m
}

// glifFileName follows the UFO 3 rule: capitals get an underscore after
// them (A -> A_.glif, so "A" and "a" differ on any file system), unsafe
// characters become underscores, clashes get a number.
func glifFileName(name string, used map[string]bool) string {
	var b strings.Builder
	for i, r := range name {
		switch {
		case r < 32 || r == 0x7F || strings.ContainsRune(`"*+/:<>?[\]|`, r):
			b.WriteByte('_')
		case i == 0 && r == '.':
			b.WriteByte('_')
		case unicode.IsUpper(r):
			b.WriteRune(r)
			b.WriteByte('_')
		default:
			b.WriteRune(r)
		}
	}
	base := b.String()
	switch strings.ToLower(strings.SplitN(base, ".", 2)[0]) {
	case "con", "prn", "aux", "clock$", "nul", "com1", "com2", "com3", "com4", "lpt1", "lpt2", "lpt3":
		base = "_" + base
	}
	if len(base) > 200 {
		base = base[:200]
	}
	file := base + ".glif"
	for n := 1; used[strings.ToLower(file)]; n++ {
		file = fmt.Sprintf("%s%015d.glif", base, n)
	}
	used[strings.ToLower(file)] = true
	return file
}

// Label colours as UFO mark colours (r,g,b,a from 0 to 1).
var markColors = map[string]string{
	"red": "0.9,0.33,0.29,1", "orange": "0.88,0.54,0.24,1", "yellow": "0.85,0.71,0.17,1",
	"green": "0.25,0.71,0.44,1", "blue": "0.23,0.56,0.92,1", "purple": "0.61,0.42,0.87,1",
}

// glif writes glyph g (in master masterID; "" = the default) in GLIF 2.
func glif(g project.Glyph, masterID string) []byte {
	contours, advance := g.Contours, g.Advance
	if l, ok := g.Layers[masterID]; ok && masterID != "" {
		contours, advance = l.Contours, l.Advance
	}
	// Smart parts, corner details and brushes have no UFO counterpart: the
	// glyph is written with its whole outline instead of components.
	flat := false
	for _, c := range g.Components {
		flat = flat || len(c.Props) > 0
	}
	for _, c := range contours {
		flat = flat || c.Brush != ""
		for _, n := range c.Nodes {
			flat = flat || n.Corner != ""
		}
	}
	if flat {
		if masterID == "" {
			contours = g.Outline()
		} else {
			own := contours
			contours = nil
			for _, c := range own {
				if c.Brush == "" {
					contours = append(contours, c)
				}
			}
			contours = append(contours, g.RefContours...)
		}
	}
	var b bytes.Buffer
	esc := func(s string) string {
		var e bytes.Buffer
		xml.EscapeText(&e, []byte(s))
		return strings.ReplaceAll(e.String(), `"`, "&quot;")
	}
	f := func(v float64) string { return strconv.FormatFloat(math.Round(v*100)/100, 'f', -1, 64) }
	fmt.Fprintf(&b, "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<glyph name=\"%s\" format=\"2\">\n", esc(g.Name))
	fmt.Fprintf(&b, "  <advance width=\"%s\"/>\n", f(advance))
	if g.Unicode > 0 {
		fmt.Fprintf(&b, "  <unicode hex=\"%04X\"/>\n", g.Unicode)
	}
	if g.Note != "" {
		fmt.Fprintf(&b, "  <note>%s</note>\n", esc(g.Note))
	}
	for _, a := range g.Anchors {
		fmt.Fprintf(&b, "  <anchor x=\"%s\" y=\"%s\" name=\"%s\"/>\n", f(a.X), f(a.Y), esc(a.Name))
	}
	b.WriteString("  <outline>\n")
	for _, c := range contours {
		if len(c.Nodes) == 0 || c.Brush != "" {
			continue
		}
		b.WriteString("    <contour>\n")
		pt := func(x, y float64, kind string, smooth bool) {
			fmt.Fprintf(&b, "      <point x=\"%s\" y=\"%s\"", f(x), f(y))
			if kind != "" {
				fmt.Fprintf(&b, " type=\"%s\"", kind)
			}
			if smooth {
				b.WriteString(" smooth=\"yes\"")
			}
			b.WriteString("/>\n")
		}
		n := len(c.Nodes)
		for i, nd := range c.Nodes {
			if i == 0 && !c.Closed {
				pt(nd.X, nd.Y, "move", false)
				continue
			}
			prev := c.Nodes[(i-1+n)%n]
			if prev.Out != nil || nd.In != nil {
				o1, o2 := prev.Out, nd.In
				if o1 == nil {
					o1 = &project.Point{X: prev.X, Y: prev.Y}
				}
				if o2 == nil {
					o2 = &project.Point{X: nd.X, Y: nd.Y}
				}
				pt(o1.X, o1.Y, "", false)
				pt(o2.X, o2.Y, "", false)
				pt(nd.X, nd.Y, "curve", nd.Smooth)
			} else {
				pt(nd.X, nd.Y, "line", nd.Smooth)
			}
		}
		b.WriteString("    </contour>\n")
	}
	if !flat {
		for _, k := range g.Components {
			fmt.Fprintf(&b, "    <component base=\"%s\"", esc(k.Glyph))
			if k.X != 0 {
				fmt.Fprintf(&b, " xOffset=\"%s\"", f(k.X))
			}
			if k.Y != 0 {
				fmt.Fprintf(&b, " yOffset=\"%s\"", f(k.Y))
			}
			b.WriteString("/>\n")
		}
	}
	b.WriteString("  </outline>\n")
	if c, ok := markColors[g.Color]; ok {
		fmt.Fprintf(&b, "  <lib>\n    <dict>\n      <key>public.markColor</key>\n      <string>%s</string>\n    </dict>\n  </lib>\n", c)
	}
	b.WriteString("</glyph>\n")
	return b.Bytes()
}

// designspace describes the masters for fontmake and other tools.
func designspace(p *project.Project, sources []string) []byte {
	type ax struct {
		tag, name     string
		min, def, max float64
		loc           func(project.Master) float64
	}
	axes := []ax{{tag: p.Axis.Tag, loc: func(m project.Master) float64 { return m.Loc }}}
	if p.Axis2 != nil {
		axes = append(axes, ax{tag: p.Axis2.Tag, loc: func(m project.Master) float64 {
			if m.Loc2 == 0 {
				return 100
			}
			return m.Loc2
		}})
	}
	names := map[string]string{"wght": "Weight", "wdth": "Width", "slnt": "Slant", "ital": "Italic", "opsz": "Optical size"}
	for i := range axes {
		a := &axes[i]
		a.name = names[strings.ToLower(a.tag)]
		if a.name == "" {
			a.name = a.tag
		}
		a.def = a.loc(p.Masters[0])
		a.min, a.max = a.def, a.def
		for _, m := range p.Masters {
			a.min, a.max = math.Min(a.min, a.loc(m)), math.Max(a.max, a.loc(m))
		}
	}
	var b bytes.Buffer
	esc := func(s string) string {
		var e bytes.Buffer
		xml.EscapeText(&e, []byte(s))
		return strings.ReplaceAll(e.String(), `"`, "&quot;")
	}
	f := func(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }
	b.WriteString("<?xml version='1.0' encoding='UTF-8'?>\n<designspace format=\"5.0\">\n  <axes>\n")
	for _, a := range axes {
		fmt.Fprintf(&b, "    <axis tag=\"%s\" name=\"%s\" minimum=\"%s\" default=\"%s\" maximum=\"%s\"/>\n", esc(a.tag), esc(a.name), f(a.min), f(a.def), f(a.max))
	}
	b.WriteString("  </axes>\n  <sources>\n")
	for i, m := range p.Masters {
		fmt.Fprintf(&b, "    <source filename=\"%s\" name=\"%s\" familyname=\"%s\" stylename=\"%s\">\n      <location>\n", esc(sources[i]), esc(m.Name), esc(p.Info.FamilyName), esc(m.Name))
		for _, a := range axes {
			fmt.Fprintf(&b, "        <dimension name=\"%s\" xvalue=\"%s\"/>\n", esc(a.name), f(a.loc(m)))
		}
		b.WriteString("      </location>\n    </source>\n")
	}
	b.WriteString("  </sources>\n</designspace>\n")
	return b.Bytes()
}
