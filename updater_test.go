package main

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestNewer(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"v0.10.0", "v0.9.0", true},
		{"v1.0.0", "v0.99.9", true},
		{"v0.9.0", "v0.9.0", false},
		{"v0.9.0", "v0.10.0", false},
		{"v0.9.1", "dev", false},
		{"0.11.0", "v0.10.2", true},
	}
	for _, c := range cases {
		if got := newer(c.a, c.b); got != c.want {
			t.Errorf("newer(%q, %q) = %v, want %v", c.a, c.b, got, c.want)
		}
	}
}

// Downloads the real installer of the latest release; needs network, so it
// only runs with SPLINE_NET_TEST=1.
func TestDownloadInstaller(t *testing.T) {
	if os.Getenv("SPLINE_NET_TEST") == "" {
		t.Skip("set SPLINE_NET_TEST=1 to run")
	}
	info := checkUpdate(context.Background(), true)
	if info.Error != "" || info.installer.URL == "" {
		t.Fatalf("no installer in the latest release: %+v", info)
	}
	path, err := downloadInstaller(context.Background(), info.installer)
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(path)
	bad := info.installer
	bad.Digest = "sha256:" + strings.Repeat("0", 64)
	if _, err := downloadInstaller(context.Background(), bad); err == nil {
		t.Fatal("a wrong checksum must be rejected")
	}
	bad = info.installer
	bad.URL = "https://example.com/Spline-Setup.exe"
	if _, err := downloadInstaller(context.Background(), bad); err == nil {
		t.Fatal("downloads from other sites must be rejected")
	}
}
