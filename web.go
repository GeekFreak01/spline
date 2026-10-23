package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strconv"
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
	builds     chan struct{} // limits concurrent font builds and imports
	limiter    *rateLimiter
	assets     sync.Map // path -> *asset, the embedded files ready to send
}

// asset is a static file with its ETag and, for text, a gzip copy.
type asset struct {
	data, gz []byte
	etag     string
	ctype    string
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
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			ws.serveIndex(w)
			return
		}
		if ws.serveSiteFile(w, r) {
			return
		}
		if ws.serveAsset(w, r) {
			return
		}
		http.NotFound(w, r) // no folder listings
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
		if r.Method != http.MethodPost {
			http.Error(w, "POST only", http.StatusMethodNotAllowed)
			return
		}
		data, ok := readBody(w, r, webMaxBody)
		if !ok {
			return
		}
		release, ok := ws.slot(w, r)
		if !ok {
			return
		}
		defer release()
		importFont(w, data)
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
		// No framing of the editor by other sites, no plugins, no <base>
		// tricks. Scripts are not restricted here: the site files may add
		// third-party scripts (see head.html).
		h.Set("X-Frame-Options", "DENY")
		h.Set("Content-Security-Policy", "frame-ancestors 'none'; object-src 'none'; base-uri 'self'")
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
	isUFO := r.URL.Query().Get("format") == "ufo"
	var format fontgen.Format
	if !isUFO {
		var err error
		if format, err = fontgen.ParseFormat(r.URL.Query().Get("format")); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
	}
	body, ok := readBody(w, r, webMaxBody)
	if !ok {
		return
	}
	release, ok := ws.slot(w, r)
	if !ok {
		return
	}
	defer release()
	if isUFO {
		writeUFO(w, body)
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

// slot waits (up to 20 s) for one of the build slots, so many visitors at
// once cannot run more font builds or imports than the server has cores.
func (ws *webServer) slot(w http.ResponseWriter, r *http.Request) (release func(), ok bool) {
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	select {
	case ws.builds <- struct{}{}:
		return func() { <-ws.builds }, true
	case <-ctx.Done():
		http.Error(w, "server is busy, try again", http.StatusServiceUnavailable)
		return nil, false
	}
}

// serveAsset sends an embedded file with an ETag (so a reload costs a 304,
// not the whole file) and gzip for text when the browser takes it.
// Directories and missing files are left to the caller.
func (ws *webServer) serveAsset(w http.ResponseWriter, r *http.Request) bool {
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "" || (r.Method != http.MethodGet && r.Method != http.MethodHead) {
		return false
	}
	var a *asset
	if v, ok := ws.assets.Load(name); ok {
		a = v.(*asset)
	} else {
		data, err := fs.ReadFile(ws.static, name)
		if err != nil {
			return false // a directory or nothing: no listing, a 404 from the file server
		}
		sum := sha256.Sum256(data)
		a = &asset{data: data, etag: `"` + hex.EncodeToString(sum[:8]) + `"`, ctype: mime.TypeByExtension(path.Ext(name))}
		if a.ctype == "" {
			a.ctype = http.DetectContentType(data)
		}
		if strings.HasPrefix(a.ctype, "text/") || strings.Contains(a.ctype, "javascript") || strings.Contains(a.ctype, "json") || strings.Contains(a.ctype, "svg") {
			var b bytes.Buffer
			zw, _ := gzip.NewWriterLevel(&b, gzip.BestCompression)
			zw.Write(data)
			zw.Close()
			if b.Len() < len(data) {
				a.gz = b.Bytes()
			}
		}
		ws.assets.Store(name, a)
	}
	h := w.Header()
	h.Set("Content-Type", a.ctype)
	h.Set("ETag", a.etag)
	h.Set("Vary", "Accept-Encoding")
	if match := r.Header.Get("If-None-Match"); match != "" && strings.Contains(match, a.etag) {
		w.WriteHeader(http.StatusNotModified)
		return true
	}
	body := a.data
	if a.gz != nil && strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		h.Set("Content-Encoding", "gzip")
		body = a.gz
	}
	h.Set("Content-Length", strconv.Itoa(len(body)))
	if r.Method == http.MethodHead {
		return true
	}
	w.Write(body)
	return true
}
