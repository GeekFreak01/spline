package main

import (
	"path/filepath"
	"testing"
)

func TestInstallRecord(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("APPDATA", dir)         // Windows
	t.Setenv("XDG_CONFIG_HOME", dir) // Linux
	t.Setenv("HOME", dir)            // macOS
	a, b := filepath.Join(dir, "A-1.ttf"), filepath.Join(dir, "A-2.ttf")
	if isOurs(a) {
		t.Fatal("empty record claims a font")
	}
	remember(a, "")
	if !isOurs(a) {
		t.Fatal("remembered font not found")
	}
	remember(b, a)
	if isOurs(a) || !isOurs(b) {
		t.Fatal("replaced font still recorded, or the new one missing")
	}
}
