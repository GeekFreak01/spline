package main

import (
	"bytes"
	"context"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/GeekFreak01/spline/internal/fontgen"
)

// Web mode (spline --web :8080) serves the editor as a public website, for
// example behind Caddy at https://spline.example.com. Everything that only
// makes sense on the user's own computer is switched off: saving to disk,
// file associations, self-update, the app window. Fonts are still built on
// the server, with limits so one visitor cannot overload it.
//
// A site directory (--site-dir) can add site-specific content that is not
// part of the open-source code:
//
//	head.html     inserted into <head> (meta tags, scripts)
//	sidebar.html  shown at the bottom of the left panel
//	privacy.html, robots.txt, ...  served as plain files

const (
	webMaxBody      = 8 << 20 // a big font project is well below this
	webExportsPerIP = 30      // exports per minute per visitor
	headMarker      = "<!--site:head-->"
	sidebarMarker   = "<!--site:sidebar-->"
)

type webServer struct {
	hosts      map[string]bool // allowed Host headers; empty = any
	siteDir    string
	trustProxy bool
	static     fs.FS
	builds     chan struct{} // limits concurrent font builds
	limiter    *rateLimiter
}

func runWeb(addr, hosts, siteDir string, trustProxy, dev bool) {
	static, _ := fs.Sub(webFS, "web")
	if dev {
		static = os.DirFS("web")
	}
	ws := &webServer{
		hosts:      map[string]bool{},
		siteDir:    siteDir,
		trustProxy: trustProxy,
		static:     static,
		builds:     make(chan struct{}, max(2, runtime.NumCPU())),
		limiter:    newRateLimiter(webExportsPerIP, time.Minute),
	}
	for _, h := range strings.Split(hosts, ",") {
		if h = strings.TrimSpace(strings.ToLower(h)); h != "" {
			ws.hosts[h] = true
		}
	}
	srv := &http.Server{
		Addr:              addr,
		Handler:           ws.routes(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       2 * time.Minute,
		MaxHeaderBytes:    64 << 10,
	}
	log.Printf("Spline %s web mode on %s (site dir: %q)", version, addr, siteDir)
	log.Fatal(srv.ListenAndServe())
}

func (ws *webServer) routes() http.Handler {
	mux := http.NewServeMux()
	files := http.FileServer(http.FS(ws.static))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			ws.serveIndex(w)
			return
		}
		if ws.serveSiteFile(w, r) {
			return
		}
		files.ServeHTTP(w, r)
	})
	mux.HandleFunc("/api/session", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"version": version, "web": true, "privacy": ws.siteFileExists("privacy.html")})
	})
	mux.HandleFunc("/api/export", ws.handleExport)
	mux.HandleFunc("/api/import-font", func(w http.ResponseWriter, r *http.Request) {
		if !ws.limiter.allow(ws.clientIP(r)) {
			w.Header().Set("Retry-After", "60")
			http.Error(w, "too many requests, try again in a minute", http.StatusTooManyRequests)
			return
		}
		handleImportFont(w, r)
	})
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok")) })
	return ws.guard(mux)
}

func (ws *webServer) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := strings.ToLower(r.Host)
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h
		}
		if len(ws.hosts) > 0 && !ws.hosts[host] && r.URL.Path != "/healthz" {
			http.Error(w, "unknown host", http.StatusMisdirectedRequest)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Header.Get("X-Spline") != "1" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("Cache-Control", "no-cache")
		next.ServeHTTP(w, r)
	})
}

// serveIndex fills the page's site slots from the site directory.
func (ws *webServer) serveIndex(w http.ResponseWriter) {
	page, err := fs.ReadFile(ws.static, "index.html")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	page = bytes.Replace(page, []byte(headMarker), ws.siteFile("head.html"), 1)
	page = bytes.Replace(page, []byte(sidebarMarker), ws.siteFile("sidebar.html"), 1)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(page)
}

func (ws *webServer) siteFile(name string) []byte {
	if ws.siteDir == "" {
		return nil
	}
	data, _ := os.ReadFile(filepath.Join(ws.siteDir, name))
	return bytes.TrimSpace(data)
}

func (ws *webServer) siteFileExists(name string) bool {
	if ws.siteDir == "" {
		return false
	}
	_, err := os.Stat(filepath.Join(ws.siteDir, name))
	return err == nil
}

// serveSiteFile serves top-level files of the site directory (robots.txt,
// privacy.html, ...). The two slot snippets are never served directly.
func (ws *webServer) serveSiteFile(w http.ResponseWriter, r *http.Request) bool {
	if ws.siteDir == "" {
		return false
	}
	name := path.Base(path.Clean(r.URL.Path))
	if r.URL.Path != "/"+name || name == "head.html" || name == "sidebar.html" || strings.HasPrefix(name, ".") {
		return false
	}
	full := filepath.Join(ws.siteDir, name)
	if st, err := os.Stat(full); err != nil || st.IsDir() {
		return false
	}
	http.ServeFile(w, r, full)
	return true
}

func (ws *webServer) clientIP(r *http.Request) string {
	if ws.trustProxy {
		// Caddy appends the real client address as the last entry.
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			return strings.TrimSpace(parts[len(parts)-1])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (ws *webServer) handleExport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	if !ws.limiter.allow(ws.clientIP(r)) {
		w.Header().Set("Retry-After", "60")
		http.Error(w, "too many requests, try again in a minute", http.StatusTooManyRequests)
		return
	}
	if r.URL.Query().Get("format") == "ufo" {
		exportUFO(w, r)
		return
	}
	format, err := fontgen.ParseFormat(r.URL.Query().Get("format"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, webMaxBody)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "project is too large", http.StatusRequestEntityTooLarge)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	select {
	case ws.builds <- struct{}{}:
		defer func() { <-ws.builds }()
	case <-ctx.Done():
		http.Error(w, "server is busy, try again", http.StatusServiceUnavailable)
		return
	}
	data, status, err := buildFont(body, format)
	if err != nil {
		http.Error(w, err.Error(), status)
		return
	}
	writeFont(w, format, data)
}

// rateLimiter allows n events per window for each key (fixed window).
type rateLimiter struct {
	mu     sync.Mutex
	n      int
	window time.Duration
	start  time.Time
	counts map[string]int
}

func newRateLimiter(n int, window time.Duration) *rateLimiter {
	return &rateLimiter{n: n, window: window, start: time.Now(), counts: map[string]int{}}
}

func (l *rateLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if time.Since(l.start) > l.window {
		l.start, l.counts = time.Now(), map[string]int{}
	}
	l.counts[key]++
	return l.counts[key] <= l.n
}
