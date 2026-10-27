package ufo

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"math"
	"path"
	"sort"
	"strconv"
	"strings"

	"github.com/GeekFreak01/spline/internal/project"
)

const (
	maxGlyphs = 3000
	maxFile   = 64 << 20 // unpacked, all files together
)

// IsZip tells whether data looks like a zip archive (.ufoz, .zip).
func IsZip(data []byte) bool { return len(data) > 4 && string(data[:4]) == "PK\x03\x04" }

// Import reads a .ufoz, or a .zip with one UFO or a .designspace and its
// UFOs (which become masters). skipped counts glyphs left out over the limit.
func Import(data []byte) (p *project.Project, skipped int, err error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, 0, fmt.Errorf("not a zip archive: %w", err)
	}
	files := map[string][]byte{}
	total := 0
	for _, f := range zr.File {
		if f.FileInfo().IsDir() || strings.HasPrefix(path.Base(f.Name), "._") || strings.Contains(f.Name, "__MACOSX") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, 0, err
		}
		b, err := io.ReadAll(io.LimitReader(rc, maxFile-int64(total)+1))
		rc.Close()
		if err != nil {
			return nil, 0, err
		}
		total += len(b)
		if total > maxFile {
			return nil, 0, errors.New("the archive is too large")
		}
		files[strings.TrimPrefix(path.Clean("/"+f.Name), "/")] = b
	}
	// UFO roots: folders with a metainfo.plist.
	var roots []string
	var dsName string
	for name := range files {
		if path.Base(name) == "metainfo.plist" {
			roots = append(roots, path.Dir(name))
		}
		if strings.HasSuffix(strings.ToLower(name), ".designspace") && dsName == "" {
			dsName = name
		}
	}
	sort.Strings(roots)
	if len(roots) == 0 {
		return nil, 0, errors.New("no UFO font in the archive")
	}
	if dsName != "" {
		if p, skipped, err := importDesignspace(files, dsName, roots); err == nil {
			return p, skipped, nil
		} else if len(roots) == 0 {
			return nil, 0, err
		}
	}
	u, err := readUFO(files, roots[0])
	if err != nil {
		return nil, 0, err
	}
	return u.project, u.skipped, nil
}

type ufoFont struct {
	project *project.Project
	skipped int
}

// readUFO reads the UFO at root into a plain project.
func readUFO(files map[string][]byte, root string) (*ufoFont, error) {
	get := func(name string) []byte { return files[path.Join(root, name)] }
	p := &project.Project{Format: project.FormatName, Version: project.CurrentVersion}
	in := &p.Info
	in.UnitsPerEm, in.Ascender, in.Descender, in.XHeight, in.CapHeight = 1000, 800, -200, 500, 700
	if fi := get("fontinfo.plist"); fi != nil {
		m, err := readDict(fi)
		if err != nil {
			return nil, fmt.Errorf("fontinfo.plist: %w", err)
		}
		readFontInfo(m, in)
	}
	if in.FamilyName == "" {
		in.FamilyName = strings.TrimSuffix(path.Base(root), ".ufo")
	}
	if in.StyleName == "" {
		in.StyleName = "Regular"
	}

	// The default layer.
	glyphDir := "glyphs"
	if lc := get("layercontents.plist"); lc != nil {
		if v, err := parsePlist(lc); err == nil {
			if list, ok := v.([]any); ok {
				for _, e := range list {
					if pair, ok := e.([]any); ok && len(pair) == 2 && str(pair[0]) == "public.default" {
						glyphDir = str(pair[1])
					}
				}
			}
		}
	}
	contents, err := readDict(get(glyphDir + "/contents.plist"))
	if err != nil {
		return nil, fmt.Errorf("%s/contents.plist: %w", glyphDir, err)
	}
	var lib map[string]any
	if l := get("lib.plist"); l != nil {
		lib, _ = readDict(l)
	}
	// Glyph order: public.glyphOrder, then the rest by name.
	var order []string
	seen := map[string]bool{}
	if list, ok := lib["public.glyphOrder"].([]any); ok {
		for _, e := range list {
			if n := str(e); n != "" && contents[n] != nil && !seen[n] {
				order = append(order, n)
				seen[n] = true
			}
		}
	}
	var rest []string
	for n := range contents {
		if !seen[n] {
			rest = append(rest, n)
		}
	}
	sort.Strings(rest)
	order = append(order, rest...)
	skip := map[string]bool{}
	if list, ok := lib["public.skipExportGlyphs"].([]any); ok {
		for _, e := range list {
			skip[str(e)] = true
		}
	}
	u := &ufoFont{project: p}
	for _, name := range order {
		if len(p.Glyphs) >= maxGlyphs {
			u.skipped++
			continue
		}
		data := get(glyphDir + "/" + str(contents[name]))
		if data == nil {
			continue
		}
		g, err := parseGlif(data)
		if err != nil {
			return nil, fmt.Errorf("glyph %q: %w", name, err)
		}
		g.Name = name
		g.NoExport = skip[name]
		p.Glyphs = append(p.Glyphs, g)
	}

	// Kerning groups: kern1 = right sides, kern2 = left sides. Other
	// group names count by where the kerning uses them.
	groups := map[string][]string{}
	if gp := get("groups.plist"); gp != nil {
		if m, err := readDict(gp); err == nil {
			for k, v := range m {
				if list, ok := v.([]any); ok {
					for _, e := range list {
						groups[k] = append(groups[k], str(e))
					}
				}
			}
		}
	}
	short := func(k string) string {
		k = strings.TrimPrefix(strings.TrimPrefix(k, "public.kern1."), "public.kern2.")
		return strings.TrimPrefix(k, "@")
	}
	byName := map[string]*project.Glyph{}
	for i := range p.Glyphs {
		byName[p.Glyphs[i].Name] = &p.Glyphs[i]
	}
	firstGroup, secondGroup := map[string]bool{}, map[string]bool{}
	var kerning map[string]any
	if kp := get("kerning.plist"); kp != nil {
		kerning, _ = readDict(kp)
	}
	for first, row := range kerning {
		if _, ok := groups[first]; ok {
			firstGroup[first] = true
		}
		if r, ok := row.(map[string]any); ok {
			for second := range r {
				if _, ok := groups[second]; ok {
					secondGroup[second] = true
				}
			}
		}
	}
	for k, members := range groups {
		right := strings.HasPrefix(k, "public.kern1.") || (firstGroup[k] && !strings.HasPrefix(k, "public.kern2."))
		left := strings.HasPrefix(k, "public.kern2.") || (secondGroup[k] && !strings.HasPrefix(k, "public.kern1."))
		for _, n := range members {
			g := byName[n]
			if g == nil {
				continue
			}
			if right && g.KernRight == "" {
				g.KernRight = short(k)
			}
			if left && g.KernLeft == "" {
				g.KernLeft = short(k)
			}
		}
	}
	key := func(k string) string {
		if _, ok := groups[k]; ok {
			return "@" + short(k)
		}
		return k
	}
	for first, row := range kerning {
		r, ok := row.(map[string]any)
		if !ok {
			continue
		}
		for second, v := range r {
			if f, ok := num(v); ok && math.Abs(f) <= 5000 {
				if p.Kerning == nil {
					p.Kerning = map[string]map[string]float64{}
				}
				a := key(first)
				if p.Kerning[a] == nil {
					p.Kerning[a] = map[string]float64{}
				}
				p.Kerning[a][key(second)] = math.Round(f)
			}
		}
	}
	return u, nil
}

func readFontInfo(m map[string]any, in *project.Info) {
	i := func(k string, dst *int) {
		if v, ok := num(m[k]); ok {
			*dst = int(math.Round(v))
		}
	}
	s := func(k string, dst *string, n int) {
		if v := strings.TrimSpace(str(m[k])); v != "" {
			if len([]rune(v)) > n {
				v = string([]rune(v)[:n])
			}
			*dst = v
		}
	}
	s("familyName", &in.FamilyName, 60)
	s("styleName", &in.StyleName, 40)
	i("unitsPerEm", &in.UnitsPerEm)
	i("ascender", &in.Ascender)
	i("descender", &in.Descender)
	i("xHeight", &in.XHeight)
	i("capHeight", &in.CapHeight)
	s("copyright", &in.Copyright, 5000)
	s("trademark", &in.Trademark, 5000)
	s("openTypeNameDesigner", &in.Designer, 80)
	s("openTypeNameManufacturer", &in.Manufacturer, 5000)
	s("openTypeNameManufacturerURL", &in.VendorURL, 5000)
	s("openTypeNameLicense", &in.License, 5000)
	s("openTypeNameLicenseURL", &in.LicenseURL, 5000)
	s("openTypeNameDescription", &in.Description, 5000)
	i("openTypeOS2WeightClass", &in.Weight)
	if v, ok := num(m["italicAngle"]); ok {
		in.ItalicAngle = math.Max(-45, math.Min(45, v))
	}
	i("openTypeHheaLineGap", &in.LineGap)
	i("postscriptUnderlinePosition", &in.UnderlinePos)
	i("postscriptUnderlineThickness", &in.UnderlineW)
	if a, ok := num(m["versionMajor"]); ok {
		b, _ := num(m["versionMinor"])
		in.Version = fmt.Sprintf("%d.%03d", int(a), int(b))
	}
	// Overshoot from the baseline zone of the BlueValues.
	if list, ok := m["postscriptBlueValues"].([]any); ok && len(list) >= 2 {
		lo, ok1 := num(list[0])
		hi, ok2 := num(list[1])
		if ok1 && ok2 && hi == 0 && lo < 0 && lo >= -100 {
			in.Overshoot = int(-lo)
		}
	}
	if in.UnitsPerEm < 16 || in.UnitsPerEm > 16384 {
		in.UnitsPerEm = 1000
	}
	if in.Descender > 0 {
		in.Descender = -in.Descender
	}
}

// Mark colours back to the nearest label colour.
func labelFor(mark string) string {
	parts := strings.Split(mark, ",")
	if len(parts) < 3 {
		return ""
	}
	var c [3]float64
	for k := 0; k < 3; k++ {
		c[k], _ = strconv.ParseFloat(strings.TrimSpace(parts[k]), 64)
	}
	best, bestD := "", math.Inf(1)
	for name, v := range markColors {
		var d float64
		q := strings.Split(v, ",")
		for k := 0; k < 3; k++ {
			x, _ := strconv.ParseFloat(q[k], 64)
			d += (x - c[k]) * (x - c[k])
		}
		if d < bestD {
			best, bestD = name, d
		}
	}
	return best
}

// GLIF, versions 1 and 2.
type glifXML struct {
	Advance struct {
		Width float64 `xml:"width,attr"`
	} `xml:"advance"`
	Unicodes []struct {
		Hex string `xml:"hex,attr"`
	} `xml:"unicode"`
	Note    string `xml:"note"`
	Anchors []struct {
		X    float64 `xml:"x,attr"`
		Y    float64 `xml:"y,attr"`
		Name string  `xml:"name,attr"`
	} `xml:"anchor"`
	Outline struct {
		Contours []struct {
			Points []struct {
				X      float64 `xml:"x,attr"`
				Y      float64 `xml:"y,attr"`
				Type   string  `xml:"type,attr"`
				Smooth string  `xml:"smooth,attr"`
				Name   string  `xml:"name,attr"`
			} `xml:"point"`
		} `xml:"contour"`
		Components []struct {
			Base    string  `xml:"base,attr"`
			XOffset float64 `xml:"xOffset,attr"`
			YOffset float64 `xml:"yOffset,attr"`
		} `xml:"component"`
	} `xml:"outline"`
	Lib struct {
		Inner []byte `xml:",innerxml"`
	} `xml:"lib"`
}

type gpt struct {
	x, y   float64
	kind   string // "" = off-curve
	smooth bool
}

func parseGlif(data []byte) (project.Glyph, error) {
	var gx glifXML
	if err := xml.Unmarshal(data, &gx); err != nil {
		return project.Glyph{}, err
	}
	g := project.Glyph{Advance: gx.Advance.Width, Note: strings.TrimSpace(gx.Note)}
	if len(gx.Unicodes) > 0 {
		if v, err := strconv.ParseInt(gx.Unicodes[0].Hex, 16, 32); err == nil && v > 0 && v <= 0x10FFFF {
			g.Unicode = int(v)
		}
	}
	for _, a := range gx.Anchors {
		if a.Name != "" {
			g.Anchors = append(g.Anchors, project.Anchor{Name: a.Name, X: a.X, Y: a.Y})
		}
	}
	for _, c := range gx.Outline.Contours {
		var pts []gpt
		for _, p := range c.Points {
			pts = append(pts, gpt{p.X, p.Y, p.Type, p.Smooth == "yes"})
		}
		// GLIF 1 stores an anchor as a one-point "move" contour with a name.
		if len(c.Points) == 1 && c.Points[0].Type == "move" && c.Points[0].Name != "" {
			g.Anchors = append(g.Anchors, project.Anchor{Name: c.Points[0].Name, X: c.Points[0].X, Y: c.Points[0].Y})
			continue
		}
		if ct, ok := contourOf(pts); ok {
			g.Contours = append(g.Contours, ct)
		}
	}
	for _, k := range gx.Outline.Components {
		if k.Base != "" {
			g.Components = append(g.Components, project.Component{Glyph: k.Base, X: k.XOffset, Y: k.YOffset})
		}
	}
	if gx.Lib.Inner != nil {
		if m, err := readDict(append(append([]byte("<plist>"), gx.Lib.Inner...), []byte("</plist>")...)); err == nil {
			g.Color = labelFor(str(m["public.markColor"]))
		}
	}
	if g.Contours == nil {
		g.Contours = []project.Contour{}
	}
	return g, nil
}

// contourOf turns GLIF points into Spline nodes: off-curve points before a
// curve point are its handles; a qcurve (TrueType quadratic) becomes cubic.
func contourOf(pts []gpt) (project.Contour, bool) {
	if len(pts) == 0 {
		return project.Contour{}, false
	}
	closed := pts[0].kind != "move"
	if closed {
		// Start at an on-curve point; the off-curves before it go last.
		k := -1
		for i, p := range pts {
			if p.kind != "" {
				k = i
				break
			}
		}
		if k < 0 {
			return project.Contour{}, false // all off-curve: an exotic quadratic circle
		}
		pts = append(append([]gpt{}, pts[k:]...), pts[:k]...)
	}
	c := project.Contour{Closed: closed}
	var pending []gpt
	segment := func(to gpt, toNode *project.Node) {
		if len(c.Nodes) == 0 {
			return
		}
		from := &c.Nodes[len(c.Nodes)-1]
		switch {
		case to.kind == "qcurve" || (len(pending) == 1 && to.kind != "curve"):
			// Quadratic: the off-curves with implied on-curves between them.
			q := pending
			start := project.Point{X: from.X, Y: from.Y}
			for i, ctrl := range q {
				end := project.Point{X: to.x, Y: to.y}
				if i < len(q)-1 {
					end = project.Point{X: (ctrl.x + q[i+1].x) / 2, Y: (ctrl.y + q[i+1].y) / 2}
				}
				c1 := &project.Point{X: start.X + 2.0/3*(ctrl.x-start.X), Y: start.Y + 2.0/3*(ctrl.y-start.Y)}
				c2 := &project.Point{X: end.X + 2.0/3*(ctrl.x-end.X), Y: end.Y + 2.0/3*(ctrl.y-end.Y)}
				c.Nodes[len(c.Nodes)-1].Out = c1
				if i < len(q)-1 {
					c.Nodes = append(c.Nodes, project.Node{X: end.X, Y: end.Y, In: c2, Smooth: true})
				} else {
					toNode.In = c2
				}
				start = end
			}
		case len(pending) >= 2:
			o1, o2 := pending[0], pending[len(pending)-1]
			from.Out = &project.Point{X: o1.x, Y: o1.y}
			toNode.In = &project.Point{X: o2.x, Y: o2.y}
		}
	}
	for i, p := range pts {
		if p.kind == "" {
			pending = append(pending, p)
			continue
		}
		node := project.Node{X: p.x, Y: p.y, Smooth: p.smooth}
		if i > 0 {
			segment(p, &node)
		}
		c.Nodes = append(c.Nodes, node)
		pending = nil
	}
	// Closing segment: from the last node back to the first.
	if closed && len(c.Nodes) > 0 {
		first := c.Nodes[0]
		kind := "line"
		if len(pending) > 0 {
			kind = pts[0].kind
		}
		segment(gpt{first.X, first.Y, kind, first.Smooth}, &first)
		c.Nodes[0].In = first.In
		// The first point repeated at the end (some tools do this) goes.
		if n := len(c.Nodes); n > 1 {
			last := c.Nodes[n-1]
			if last.X == first.X && last.Y == first.Y && last.Out == nil && len(pending) == 0 {
				c.Nodes[0].In = last.In
				c.Nodes = c.Nodes[:n-1]
			}
		}
	}
	if (closed && len(c.Nodes) < 2) || len(c.Nodes) < 1 {
		return project.Contour{}, false
	}
	return c, true
}

// --- designspace

type dsXML struct {
	Axes []struct {
		Tag     string  `xml:"tag,attr"`
		Name    string  `xml:"name,attr"`
		Minimum float64 `xml:"minimum,attr"`
		Default float64 `xml:"default,attr"`
		Maximum float64 `xml:"maximum,attr"`
	} `xml:"axes>axis"`
	Sources []struct {
		Filename  string `xml:"filename,attr"`
		Name      string `xml:"name,attr"`
		StyleName string `xml:"stylename,attr"`
		Layer     string `xml:"layer,attr"`
		Location  []struct {
			Name   string  `xml:"name,attr"`
			XValue float64 `xml:"xvalue,attr"`
		} `xml:"location>dimension"`
	} `xml:"sources>source"`
}

// importDesignspace makes masters out of the sources: the one at the
// default location is the default master.
func importDesignspace(files map[string][]byte, dsName string, roots []string) (*project.Project, int, error) {
	var ds dsXML
	if err := xml.Unmarshal(files[dsName], &ds); err != nil {
		return nil, 0, err
	}
	if len(ds.Axes) == 0 || len(ds.Sources) < 2 {
		return nil, 0, errors.New("designspace: needs an axis and two sources")
	}
	// An Italic axis (ital) is not blended: it marks the italic masters.
	italName := ""
	axes := ds.Axes[:0:0]
	for _, a := range ds.Axes {
		if strings.EqualFold(a.Tag, "ital") {
			italName = a.Name
			continue
		}
		axes = append(axes, a)
	}
	if len(axes) == 0 {
		return nil, 0, errors.New("designspace: no axis to blend")
	}
	if len(axes) > 2 {
		axes = axes[:2]
	}
	type src struct {
		name   string
		loc    []float64
		font   *ufoFont
		italic bool
	}
	var srcs []src
	for _, s := range ds.Sources {
		if s.Layer != "" {
			continue // sparse layers are not supported
		}
		root := path.Clean(path.Join(path.Dir(dsName), s.Filename))
		found := false
		for _, r := range roots {
			found = found || r == root
		}
		if !found {
			continue
		}
		u, err := readUFO(files, root)
		if err != nil {
			return nil, 0, err
		}
		loc := make([]float64, len(axes))
		for k, a := range axes {
			loc[k] = a.Default
			for _, d := range s.Location {
				if d.Name == a.Name || d.Name == a.Tag {
					loc[k] = d.XValue
				}
			}
		}
		name := s.StyleName
		if name == "" {
			name = u.project.Info.StyleName
		}
		italic := false
		for _, d := range s.Location {
			if italName != "" && (d.Name == italName || strings.EqualFold(d.Name, "ital")) && d.XValue > 0 {
				italic = true
			}
		}
		srcs = append(srcs, src{name, loc, u, italic})
	}
	if len(srcs) < 2 {
		return nil, 0, errors.New("designspace: the sources are missing")
	}
	// The default source first.
	def := 0
	for i, s := range srcs {
		at := !s.italic
		for k, a := range axes {
			at = at && s.loc[k] == a.Default
		}
		if at {
			def = i
			break
		}
	}
	srcs[0], srcs[def] = srcs[def], srcs[0]
	p := srcs[0].font.project
	p.Axis = &project.Axis{Tag: axes[0].Tag, Min: axes[0].Minimum, Max: axes[0].Maximum}
	if len(axes) > 1 {
		p.Axis2 = &project.Axis{Tag: axes[1].Tag, Min: axes[1].Minimum, Max: axes[1].Maximum}
	}
	for i, s := range srcs {
		m := project.Master{ID: fmt.Sprintf("m%d", i), Name: s.name, Loc: s.loc[0], Italic: s.italic}
		if s.italic {
			m.ItalicAngle = math.Abs(s.font.project.Info.ItalicAngle)
			if m.ItalicAngle == 0 {
				m.ItalicAngle = 10
			}
		}
		if len(axes) > 1 {
			m.Loc2 = s.loc[1]
		}
		if i > 0 {
			m.Kerning = s.font.project.Kerning
			if m.Kerning == nil {
				m.Kerning = map[string]map[string]float64{}
			}
			other := map[string]*project.Glyph{}
			for j := range s.font.project.Glyphs {
				other[s.font.project.Glyphs[j].Name] = &s.font.project.Glyphs[j]
			}
			for j := range p.Glyphs {
				g := &p.Glyphs[j]
				if o := other[g.Name]; o != nil {
					if g.Layers == nil {
						g.Layers = map[string]project.Layer{}
					}
					g.Layers[m.ID] = project.Layer{Contours: o.Contours, Advance: o.Advance}
				}
			}
		}
		p.Masters = append(p.Masters, m)
	}
	if strings.EqualFold(p.Axis.Tag, "wght") {
		p.Info.Weight = int(math.Round(srcs[0].loc[0]))
	}
	return p, srcs[0].font.skipped, nil
}
