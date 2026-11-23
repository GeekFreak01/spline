package main

import "testing"

func TestLimitKey(t *testing.T) {
	for in, want := range map[string]string{
		"203.0.113.7":             "203.0.113.7",
		"2001:db8:1:2:aaaa::1":    "2001:db8:1:2::/64",
		"2001:db8:1:2:ffff:1:2:3": "2001:db8:1:2::/64",
		"not an address":          "not an address",
	} {
		if got := limitKey(in); got != want {
			t.Errorf("limitKey(%q) = %q, want %q", in, got, want)
		}
	}
}
