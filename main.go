// Spline is a friendly font editor. It runs a small local web server and
// opens the editor in your browser. Usage:
//
//	spline              start with the last project
//	spline myfont.sp    open a project file
package main

import (
	"embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/GeekFreak01/spline/internal/fontgen"
	"github.com/GeekFreak01/spline/internal/project"
)

// version is set at build time: -ldflags "-X main.version=v1.2.3"
var version = "dev"

//go:embed all:web
var webFS embed.FS

const maxBody = 64 << 20

type server struct {
	mu       sync.Mutex
	filePath string // project opened from the command line, saved in place
	port     int
	dev      bool
}

func main() {
	port := flag.Int("port", 7878, "port to listen on (127.0.0.1 only)")
	noBrowser := flag.Bool("no-browser", false, "do not open the browser")
	dev := flag.Bool("dev", false, "serve ./web from disk (for developing the UI)")
	flag.Parse()

	s := &server{dev: *dev}
	if flag.NArg() > 0 {
		p, err := filepath.Abs(flag.Arg(0))
		if err != nil {
			log.Fatal(err)
		}
		s.filePath = p
	}

	// The browser keeps autosaves per port, so prefer a stable one.
	var ln net.Listener
	var err error
	for p := *port; p < *port+20; p++ {
		ln, err = net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p))
		if err == nil {
			s.port = p
			break
		}
	}
	if ln == nil {
		log.Fatalf("cannot start: %v", err)
	}

	url := fmt.Sprintf("http://127.0.0.1:%d/", s.port)
	fmt.Printf("Spline %s\n", version)
	fmt.Printf("Редактор открыт / Editor is running: %s\n", url)
	fmt.Println("Закройте это окно, чтобы выйти / Close this window to quit.")
	if !*noBrowser {
		openBrowser(url)
	}
	log.Fatal(http.Serve(ln, s.routes()))
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
	Version  string          `json:"version"`
	FilePath string          `json:"filePath,omitempty"`
	FileName string          `json:"fileName,omitempty"`
	Project  json.RawMessage `json:"project,omitempty"`
	Error    string          `json:"error,omitempty"`
}

func (s *server) handleSession(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	path := s.filePath
	s.mu.Unlock()
	info := sessionInfo{Version: version}
	if path != "" {
		info.FilePath = path
		info.FileName = filepath.Base(path)
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
	format, err := fontgen.ParseFormat(r.URL.Query().Get("format"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	p, err := readProject(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	data, err := fontgen.Build(p, format)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnprocessableEntity)
		return
	}
	if format == fontgen.OTF {
		w.Header().Set("Content-Type", "font/otf")
	} else {
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
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBody))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if _, err := project.Parse(body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	tmp := s.filePath + ".tmp"
	if err := os.WriteFile(tmp, body, 0o644); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := os.Rename(tmp, s.filePath); err != nil {
		os.Remove(tmp)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"filePath": s.filePath})
}

func readProject(r *http.Request) (*project.Project, error) {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBody))
	if err != nil {
		return nil, err
	}
	return project.Parse(body)
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
