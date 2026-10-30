package ufo

import (
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
)

// Property lists (Apple XML plists) as UFO uses them: dict, array,
// string, integer, real, true, false. Decoded into map[string]any, []any,
// string, int64, float64 and bool.

func parsePlist(data []byte) (any, error) {
	d := xml.NewDecoder(bytes.NewReader(data))
	d.Strict = false
	for {
		tok, err := d.Token()
		if err != nil {
			return nil, fmt.Errorf("plist: %w", err)
		}
		if se, ok := tok.(xml.StartElement); ok && se.Name.Local != "plist" {
			return plistValue(d, se, 0)
		}
	}
}

// maxDepth bounds nesting: real UFO plists are a few levels deep, and a
// file nested millions deep would otherwise overflow the stack and kill
// the whole process (a stack overflow cannot be recovered).
const maxDepth = 64

func plistValue(d *xml.Decoder, se xml.StartElement, depth int) (any, error) {
	if depth > maxDepth {
		return nil, errors.New("plist: nested too deep")
	}
	switch se.Name.Local {
	case "dict":
		m := map[string]any{}
		key := ""
		for {
			tok, err := d.Token()
			if err != nil {
				return nil, err
			}
			switch t := tok.(type) {
			case xml.StartElement:
				if t.Name.Local == "key" {
					s, err := plistText(d)
					if err != nil {
						return nil, err
					}
					key = s
					continue
				}
				v, err := plistValue(d, t, depth+1)
				if err != nil {
					return nil, err
				}
				m[key] = v
			case xml.EndElement:
				return m, nil
			}
		}
	case "array":
		var a []any
		for {
			tok, err := d.Token()
			if err != nil {
				return nil, err
			}
			switch t := tok.(type) {
			case xml.StartElement:
				v, err := plistValue(d, t, depth+1)
				if err != nil {
					return nil, err
				}
				a = append(a, v)
			case xml.EndElement:
				return a, nil
			}
		}
	case "true", "false":
		if err := d.Skip(); err != nil {
			return nil, err
		}
		return se.Name.Local == "true", nil
	}
	s, err := plistText(d)
	if err != nil {
		return nil, err
	}
	switch se.Name.Local {
	case "integer":
		v, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
		if err != nil {
			return nil, err
		}
		return v, nil
	case "real":
		v, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
		if err != nil {
			return nil, err
		}
		return v, nil
	}
	return s, nil // string, data, date: kept as text
}

// plistText reads the text of the current element up to its end.
func plistText(d *xml.Decoder) (string, error) {
	var b strings.Builder
	for {
		tok, err := d.Token()
		if err != nil {
			return "", err
		}
		switch t := tok.(type) {
		case xml.CharData:
			b.Write(t)
		case xml.EndElement:
			return b.String(), nil
		case xml.StartElement:
			if err := d.Skip(); err != nil {
				return "", err
			}
		}
	}
}

func readDict(data []byte) (map[string]any, error) {
	v, err := parsePlist(data)
	if err != nil {
		return nil, err
	}
	m, ok := v.(map[string]any)
	if !ok {
		return nil, errors.New("plist: not a dict")
	}
	return m, nil
}

func num(v any) (float64, bool) {
	switch x := v.(type) {
	case int64:
		return float64(x), true
	case float64:
		return x, true
	}
	return 0, false
}

func str(v any) string {
	s, _ := v.(string)
	return s
}

// writePlist writes v (map[string]any with sorted keys, []any/[]string,
// string, int, float64, bool) as an XML plist.
func writePlist(v any) []byte {
	var b bytes.Buffer
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
`)
	plistWrite(&b, v, "")
	b.WriteString("</plist>\n")
	return b.Bytes()
}

func plistWrite(w io.Writer, v any, ind string) {
	esc := func(s string) string {
		var b bytes.Buffer
		xml.EscapeText(&b, []byte(s))
		return b.String()
	}
	switch x := v.(type) {
	case map[string]any:
		if len(x) == 0 {
			fmt.Fprintf(w, "%s<dict/>\n", ind)
			return
		}
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		fmt.Fprintf(w, "%s<dict>\n", ind)
		for _, k := range keys {
			fmt.Fprintf(w, "%s  <key>%s</key>\n", ind, esc(k))
			plistWrite(w, x[k], ind+"  ")
		}
		fmt.Fprintf(w, "%s</dict>\n", ind)
	case []any:
		fmt.Fprintf(w, "%s<array>\n", ind)
		for _, e := range x {
			plistWrite(w, e, ind+"  ")
		}
		fmt.Fprintf(w, "%s</array>\n", ind)
	case []string:
		fmt.Fprintf(w, "%s<array>\n", ind)
		for _, e := range x {
			fmt.Fprintf(w, "%s  <string>%s</string>\n", ind, esc(e))
		}
		fmt.Fprintf(w, "%s</array>\n", ind)
	case string:
		fmt.Fprintf(w, "%s<string>%s</string>\n", ind, esc(x))
	case int:
		fmt.Fprintf(w, "%s<integer>%d</integer>\n", ind, x)
	case float64:
		if x == float64(int64(x)) {
			fmt.Fprintf(w, "%s<integer>%d</integer>\n", ind, int64(x))
		} else {
			fmt.Fprintf(w, "%s<real>%s</real>\n", ind, strconv.FormatFloat(x, 'f', -1, 64))
		}
	case bool:
		if x {
			fmt.Fprintf(w, "%s<true/>\n", ind)
		} else {
			fmt.Fprintf(w, "%s<false/>\n", ind)
		}
	}
}
