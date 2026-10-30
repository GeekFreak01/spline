// Spline is a lightweight font editor. It runs a small local server and
// shows the editor in its own window (WebView2 on Windows, an app window of
// Chrome/Edge elsewhere, or the default browser as a fallback). Usage:
//
//	spline              start with the last project
//	spline myfont.sp    open a project file
//	spline --browser    use the regular web browser
package main

//go:generate go run ./tools/genicons

import (
	"embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/GeekFreak01/spline/internal/fontgen"
	"github.com/GeekFreak01/spline/internal/fontimport"
	"github.com/GeekFreak01/spline/internal/project"
	"github.com/GeekFreak01/spline/internal/ufo"
)

// version is set at build time: -ldflags "-X main.version=v1.2.3"
var version = "dev"

//go:embed all:web
var webFS embed.FS

const maxBody = 64 << 20

// readBody reads a request body of at most limit bytes. Too large: 413 with
// the limit in the message (not a JSON error about a cut-off body).
func readBody(w http.ResponseWriter, r *http.Request, limit int64) ([]byte, bool) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	var tooBig *http.MaxBytesError
	switch {
	case errors.As(err, &tooBig):
		http.Error(w, fmt.Sprintf("the project is too large (over %d MB)", limit>>20), http.StatusRequestEntityTooLarge)
		return nil, false
	case err != nil:
		http.Error(w, err.Error(), http.StatusBadRequest)
		return nil, false
	}
	return body, true
}

type server struct {
	mu       sync.Mutex
	filePath string // project opened from the command line, saved in place
	port     int
	dev      bool
	lastPing time.Time
	stamp    string // the file on disk as this window last read or wrote it
}

func main() {
	port := flag.Int("port", 7878, "port to listen on (127.0.0.1 only)")
	noBrowser := flag.Bool("no-browser", false, "only start the server, do not open a window")
	useBrowser := flag.Bool("browser", false, "open the editor in the default web browser instead of an app window")
	dev := flag.Bool("dev", false, "serve ./web from disk (for developing the UI)")
	view := flag.String("view", "", "start in a view, e.g. \"#kern\" or \"#glyph=A\" (docs and screenshots)")
	webAddr := flag.String("web", "", "run as a public website on this address, e.g. \":8080\" (see deploy/)")
	webHosts := flag.String("host", "", "web mode: allowed host names, comma separated (empty = any)")
	siteDir := flag.String("site-dir", "", "web mode: folder with site-specific files (head.html, sidebar.html, robots.txt, ...)")
	trustProxy := flag.Bool("trust-proxy", false, "web mode: take the visitor address from X-Forwarded-For (behind Caddy/nginx)")
	restarted := flag.Bool("restarted", false, "started by an update: wait for the old copy's port")
	flag.Parse()

	if *webAddr != "" {
		runWeb(*webAddr, *webHosts, *siteDir, *trustProxy, *dev)
		return
	}

	s := &server{dev: *dev}
	if flag.NArg() > 0 {
		p, err := filepath.Abs(flag.Arg(0))
		if err != nil {
			fatal("Spline cannot open the file: " + err.Error())
		}
		s.filePath = p
	}

	// The browser keeps autosaves per port, so prefer a stable one.
	var ln net.Listener
	var err error
	if *restarted {
		// Autosaves stay with the port, and the old copy is about to free it.
		for i := 0; i < 50 && ln == nil; i++ {
			if ln, err = net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port)); err != nil {
				ln = nil
				time.Sleep(100 * time.Millisecond)
			}
		}
		s.port = *port
		go cleanupUpdate()
	}
	for p := *port; ln == nil && p < *port+20; p++ {
		ln, err = net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p))
		if err == nil {
			s.port = p
			break
		}
	}
	if ln == nil {
		fatal(fmt.Sprintf("Spline cannot start: no free port between 7878 and 7897 (%v). Close other copies of Spline or reboot the computer.", err))
	}

	url := fmt.Sprintf("http://127.0.0.1:%d/", s.port)
	if strings.HasPrefix(*view, "#") || strings.HasPrefix(*view, "?") {
		url += *view
	}
	fmt.Printf("Spline %s: %s\n", version, url)
	serveErr := make(chan error, 1)
	go func() { serveErr <- http.Serve(ln, s.routes()) }()

	switch {
	case *noBrowser:
		// Server only (development).
	case !*useBrowser:
		opened, blocked := openWindow(url)
		if blocked {
			return // the app window was closed
		}
		if !opened {
			openBrowser(url)
		}
		go s.watchdog()
	default:
		openBrowser(url)
		go s.watchdog()
	}
	fatal("Spline stopped: " + (<-serveErr).Error())
}

// watchdog stops the program a while after the last open editor page went
// away, so no invisible process is left behind when a browser window is
// used instead of the built-in one.
func (s *server) watchdog() {
	const idle = 3 * time.Minute
	for range time.Tick(15 * time.Second) {
		s.mu.Lock()
		last := s.lastPing
		s.mu.Unlock()
		if !last.IsZero() && time.Since(last) > idle {
			os.Exit(0)
		}
	}
}

// handleAssociate registers Spline for .sp files (Windows, current user).
func (s *server) handleAssociate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	if err := associate(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]bool{"associated": true})
}

func (s *server) handlePing(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	s.lastPing = time.Now()
	s.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) routes() http.Handler {
	static, _ := fs.Sub(webFS, "web")
	if s.dev {
		static = os.DirFS("web")
	}
	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.FS(static)))
	mux.HandleFunc("/api/session", s.handleSession)
	mux.HandleFunc("/api/export", s.handleExport)
	mux.HandleFunc("/api/file", s.handleFile)
	mux.HandleFunc("/api/ping", s.handlePing)
	mux.HandleFunc("/api/associate", s.handleAssociate)
	mux.HandleFunc("/api/update", s.handleUpdate)
	mux.HandleFunc("/api/update/download", s.handleUpdateDownload)
	mux.HandleFunc("/api/update/status", s.handleUpdateStatus)
	mux.HandleFunc("/api/update/apply", s.handleUpdateApply)
	mux.HandleFunc("/api/open-page", s.handleOpenPage)
	mux.HandleFunc("/api/import-font", handleImportFont)
	mux.HandleFunc("/api/install-font", s.handleInstallFont)
	return s.guard(mux)
}

// guard blocks requests from other web sites: only our own host name is
// accepted, and state-changing calls need a custom header that a foreign
// page cannot send without a CORS preflight (which we never allow).
func (s *server) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		ok := host == fmt.Sprintf("127.0.0.1:%d", s.port) || host == fmt.Sprintf("localhost:%d", s.port)
		if !ok {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Header.Get("X-Spline") != "1" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

type sessionInfo struct {
	Version string `json:"version"`
	// CanAssociate is true on Windows, where Spline can register itself
	// for .sp files; Associated tells whether that is already done.
	CanAssociate bool            `json:"canAssociate"`
	CanInstall   bool            `json:"canInstall"`
	Associated   bool            `json:"associated"`
	FilePath     string          `json:"filePath,omitempty"`
	FileName     string          `json:"fileName,omitempty"`
	Project      json.RawMessage `json:"project,omitempty"`
	Error        string          `json:"error,omitempty"`
}

func (s *server) handleSession(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	path := s.filePath
	s.mu.Unlock()
	info := sessionInfo{Version: version, CanAssociate: canAssociate, CanInstall: canInstallFonts, Associated: associated()}
	if path != "" {
		info.FilePath = path
		info.FileName = filepath.Base(path)
		s.mu.Lock()
		s.stamp = fileStamp(path)
		s.mu.Unlock()
		data, err := os.ReadFile(path)
		switch {
		case errors.Is(err, os.ErrNotExist):
			// A new file: it will be created on first save.
		case err != nil:
			info.Error = err.Error()
		default:
			if _, err := project.Parse(data); err != nil {
				info.Error = err.Error()
			} else {
				info.Project = data
			}
		}
	}
	writeJSON(w, info)
}

func (s *server) handleExport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
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
	body, ok := readBody(w, r, maxBody)
	if !ok {
		return
	}
	data, status, err := buildFont(body, format)
	if err != nil {
		http.Error(w, err.Error(), status)
		return
	}
	writeFont(w, format, data)
}

// exportUFO answers /api/export?format=ufo: a .ufoz, or a .zip with a
// .designspace and a UFO per master; X-File-Ext names which.
func exportUFO(w http.ResponseWriter, r *http.Request) {
	body, ok := readBody(w, r, maxBody)
	if !ok {
		return
	}
	writeUFO(w, body)
}

func writeUFO(w http.ResponseWriter, body []byte) {
	p, err := project.Parse(body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	data, ext, err := ufo.Export(p)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnprocessableEntity)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("X-File-Ext", ext)
	w.Write(data)
}

// maxFontFile limits fonts opened as projects.
const maxFontFile = 16 << 20

// handleImportFont turns a posted .ttf/.otf file into a project.
func handleImportFont(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxFontFile)
	data, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "font file is too large", http.StatusRequestEntityTooLarge)
		return
	}
	importFont(w, data)
}

// importFont turns a font file (TTF/OTF, or a zip with UFO) into a project.
func importFont(w http.ResponseWriter, data []byte) {
	// A zip is a UFO (.ufoz, or UFOs with a .designspace).
	if ufo.IsZip(data) {
		p, skipped, err := ufo.Import(data)
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnprocessableEntity)
			return
		}
		writeJSON(w, map[string]any{"project": p, "skipped": skipped})
		return
	}
	res, err := fontimport.Import(data)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnprocessableEntity)
		return
	}
	writeJSON(w, map[string]any{"project": res.Project, "skipped": res.Skipped})
}

// handleInstallFont builds the posted project as TrueType and installs it
// into the system for the current user.
func (s *server) handleInstallFont(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	body, ok := readBody(w, r, maxBody)
	if !ok {
		return
	}
	p, err := project.Parse(body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	data, err := fontgen.Build(p, fontgen.TTF)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnprocessableEntity)
		return
	}
	name := fontgen.FullName(p.Info)
	path, err := installFont(data, name, safeFileName(fontgen.PostScriptName(p.Info)))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"name": name, "path": path})
}

// safeFileName keeps a name that cannot leave its folder or name an NTFS
// stream: ASCII letters, digits, "-", "_" and inner dots only. The name
// comes from the project, which may come from anyone.
func safeFileName(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			b.WriteRune(r)
		case r == '.' && b.Len() > 0:
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	out := strings.Trim(b.String(), "._")
	if out == "" {
		return "SplineFont"
	}
	return out
}

// buildFont parses a .sp document and compiles it; status is the HTTP code
// to report when it fails.
func buildFont(body []byte, format fontgen.Format) ([]byte, int, error) {
	p, err := project.Parse(body)
	if err != nil {
		return nil, http.StatusBadRequest, err
	}
	data, err := fontgen.Build(p, format)
	if err != nil {
		return nil, http.StatusUnprocessableEntity, err
	}
	return data, http.StatusOK, nil
}

func writeFont(w http.ResponseWriter, format fontgen.Format, data []byte) {
	switch format {
	case fontgen.OTF:
		w.Header().Set("Content-Type", "font/otf")
	case fontgen.WOFF:
		w.Header().Set("Content-Type", "font/woff")
	case fontgen.WOFF2:
		w.Header().Set("Content-Type", "font/woff2")
	default:
		w.Header().Set("Content-Type", "font/ttf")
	}
	w.Write(data)
}

// handleFile saves the project back to the file given on the command line.
func (s *server) handleFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		http.Error(w, "PUT only", http.StatusMethodNotAllowed)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.filePath == "" {
		http.Error(w, "no file was opened from disk", http.StatusConflict)
		return
	}
	body, ok := readBody(w, r, maxBody)
	if !ok {
		return
	}
	if _, err := project.Parse(body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	// Changed on disk since this window read or wrote it (another window,
	// another program): the page asks before overwriting.
	if st := fileStamp(s.filePath); st != s.stamp && st != "" && r.Header.Get("X-Spline-Overwrite") != "1" {
		http.Error(w, "the file was changed by another window or program", http.StatusConflict)
		return
	}
	if err := saveFile(s.filePath, body); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	s.stamp = fileStamp(s.filePath)
	writeJSON(w, map[string]string{"filePath": s.filePath})
}

// fileStamp identifies a version of a file on disk ("" when it is missing).
func fileStamp(path string) string {
	fi, err := os.Stat(path)
	if err != nil {
		return ""
	}
	return fmt.Sprintf("%d-%d", fi.Size(), fi.ModTime().UnixNano())
}

// saveFile writes data to path safely: a temporary file flushed to the disk,
// the old version kept as path.bak, then the new one moved into place. A
// crash or a full disk leaves either the old file or the new one, never a
// cut-off one.
func saveFile(path string, data []byte) error {
	tmp := fmt.Sprintf("%s.%d.tmp", path, os.Getpid())
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	_, err = f.Write(data)
	if err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(tmp)
		return err
	}
	if _, err := os.Stat(path); err == nil {
		bak := path + ".bak"
		if err := os.Rename(path, bak); err != nil {
			os.Remove(tmp)
			return err
		}
		if err := os.Rename(tmp, path); err != nil {
			os.Rename(bak, path) // put the old version back
			os.Remove(tmp)
			return err
		}
		return nil
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(v)
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		fmt.Println(strings.TrimSpace("Откройте в браузере / Open in your browser: " + url))
	}
}
