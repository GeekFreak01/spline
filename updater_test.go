package main

import "testing"

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

func TestSafeFileName(t *testing.T) {
	for in, want := range map[string]string{
		`MyFont-Bold`: "MyFont-Bold", `..\..\Windows\evil`: "Windows_evil", `a:stream`: "a_stream",
		`../x`: "x", `...`: "SplineFont", `Font.v2`: "Font.v2",
	} {
		if got := safeFileName(in); got != want {
			t.Errorf("safeFileName(%q) = %q, want %q", in, got, want)
		}
	}
}
