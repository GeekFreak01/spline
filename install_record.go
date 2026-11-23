package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
)

// errFontTaken: a font of the same name is already installed and Spline
// did not put it there. The window asks before going on.
var errFontTaken = errors.New("a font with this name is already installed")

// The fonts Spline installed, so a reinstall replaces only its own files
// and never someone else's font that happens to share the name.
var recordMu sync.Mutex

func recordPath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "Spline", "installed-fonts.json")
}

func installedBySpline() map[string]bool {
	out := map[string]bool{}
	if p := recordPath(); p != "" {
		if b, err := os.ReadFile(p); err == nil {
			var list []string
			if json.Unmarshal(b, &list) == nil {
				for _, f := range list {
					out[filepath.Clean(f)] = true
				}
			}
		}
	}
	return out
}

func isOurs(path string) bool {
	recordMu.Lock()
	defer recordMu.Unlock()
	return installedBySpline()[filepath.Clean(path)]
}

// remember adds path to the record and drops gone, if given.
func remember(path, gone string) {
	recordMu.Lock()
	defer recordMu.Unlock()
	p := recordPath()
	if p == "" {
		return
	}
	set := installedBySpline()
	if gone != "" {
		delete(set, filepath.Clean(gone))
	}
	set[filepath.Clean(path)] = true
	list := make([]string, 0, len(set))
	for f := range set {
		list = append(list, f)
	}
	b, _ := json.Marshal(list)
	os.MkdirAll(filepath.Dir(p), 0o755)
	os.WriteFile(p, b, 0o644)
}
