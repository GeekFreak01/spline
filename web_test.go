package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

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

// A build that runs too long gets a 503, but keeps its slot until it really
// ends; a quick one is answered as it wrote it; a panic is a 500.
func TestBuildTimeout(t *testing.T) {
	old := buildTimeout
	buildTimeout = 5 * time.Second
	defer func() { buildTimeout = old }()
	ws := &webServer{builds: make(chan struct{}, 1)}
	take := func() func() { ws.builds <- struct{}{}; return func() { <-ws.builds } }

	w := httptest.NewRecorder()
	ws.finish(w, take(), func(w http.ResponseWriter) {
		w.Header().Set("Content-Type", "font/ttf")
		w.Write([]byte("font"))
	})
	if w.Code != 200 || w.Body.String() != "font" || w.Header().Get("Content-Type") != "font/ttf" {
		t.Fatalf("quick build: %d %q %q", w.Code, w.Body, w.Header())
	}

	buildTimeout = 50 * time.Millisecond
	finished := make(chan struct{})
	w = httptest.NewRecorder()
	ws.finish(w, take(), func(w http.ResponseWriter) { time.Sleep(200 * time.Millisecond); close(finished) })
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("slow build: %d, want 503", w.Code)
	}
	if len(ws.builds) != 1 {
		t.Error("the slot was freed before the slow build ended")
	}
	<-finished
	time.Sleep(10 * time.Millisecond)
	if len(ws.builds) != 0 {
		t.Error("the slot stays taken after the build ended")
	}

	buildTimeout = 5 * time.Second
	w = httptest.NewRecorder()
	ws.finish(w, take(), func(w http.ResponseWriter) { panic("boom") })
	time.Sleep(10 * time.Millisecond)
	if w.Code != http.StatusInternalServerError || len(ws.builds) != 0 {
		t.Errorf("panic: %d, slots %d", w.Code, len(ws.builds))
	}
}
