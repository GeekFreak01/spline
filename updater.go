package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	repo         = "GeekFreak01/spline"
	releasesPage = "https://github.com/" + repo + "/releases/latest"
	latestAPI    = "https://api.github.com/repos/" + repo + "/releases/latest"
)

type updateInfo struct {
	Current   string `json:"current"`
	Latest    string `json:"latest,omitempty"`
	Available bool   `json:"available"`
	// Installed is true when Spline was set up with the installer, so it
	// can update itself; otherwise the release page is offered.
	Installed bool   `json:"installed"`
	Page      string `json:"page"`
	Error     string `json:"error,omitempty"`

	installer asset
}

type asset struct {
	Name   string `json:"name"`
	URL    string `json:"browser_download_url"`
	Size   int64  `json:"size"`
	Digest string `json:"digest"` // "sha256:<hex>"
}

var (
	updateMu     sync.Mutex
	updateCache  *updateInfo
	updateCached time.Time
	versionRe    = regexp.MustCompile(`^v?(\d+)\.(\d+)\.(\d+)`)
)

// newer reports whether version a is newer than b ("v1.2.3").
func newer(a, b string) bool {
	pa, pb := versionRe.FindStringSubmatch(a), versionRe.FindStringSubmatch(b)
	if pa == nil || pb == nil {
		return false
	}
	for i := 1; i <= 3; i++ {
		x, _ := strconv.Atoi(pa[i])
		y, _ := strconv.Atoi(pb[i])
		if x != y {
			return x > y
		}
	}
	return false
}

// installedWithSetup: the installer puts its uninstaller next to spline.exe.
func installedWithSetup() bool {
	if runtime.GOOS != "windows" {
		return false
	}
	exe, err := os.Executable()
	if err != nil {
		return false
	}
	_, err = os.Stat(filepath.Join(filepath.Dir(exe), "unins000.exe"))
	return err == nil
}

func checkUpdate(ctx context.Context, force bool) *updateInfo {
	updateMu.Lock()
	defer updateMu.Unlock()
	if !force && updateCache != nil && time.Since(updateCached) < time.Hour {
		return updateCache
	}
	info := &updateInfo{Current: version, Installed: installedWithSetup(), Page: releasesPage}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, latestAPI, nil)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "Spline/"+version)
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		info.Error = err.Error()
		return info
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		info.Error = resp.Status
		return info
	}
	var rel struct {
		Tag    string  `json:"tag_name"`
		Page   string  `json:"html_url"`
		Assets []asset `json:"assets"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&rel); err != nil {
		info.Error = err.Error()
		return info
	}
	info.Latest = rel.Tag
	if rel.Page != "" {
		info.Page = rel.Page
	}
	info.Available = newer(rel.Tag, version)
	for _, a := range rel.Assets {
		if strings.HasPrefix(a.Name, "Spline-Setup-") && strings.HasSuffix(a.Name, ".exe") {
			info.installer = a
		}
	}
	updateCache, updateCached = info, time.Now()
	return info
}

// downloadInstaller fetches the setup program of the latest release into the
// temp folder and checks it against the size and SHA-256 published by GitHub.
func downloadInstaller(ctx context.Context, a asset) (string, error) {
	u, err := url.Parse(a.URL)
	if err != nil || u.Scheme != "https" || u.Host != "github.com" ||
		!strings.HasPrefix(u.Path, "/"+repo+"/releases/download/") {
		return "", errors.New("unexpected download address")
	}
	if a.Size <= 0 || a.Size > 200<<20 {
		return "", errors.New("unexpected installer size")
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, a.URL, nil)
	req.Header.Set("User-Agent", "Spline/"+version)
	resp, err := (&http.Client{Timeout: 10 * time.Minute}).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", errors.New(resp.Status)
	}
	path := filepath.Join(os.TempDir(), filepath.Base(a.Name))
	f, err := os.Create(path)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(f, h), io.LimitReader(resp.Body, a.Size+1))
	f.Close()
	if err == nil && n != a.Size {
		err = fmt.Errorf("download is incomplete (%d of %d bytes)", n, a.Size)
	}
	if want, ok := strings.CutPrefix(a.Digest, "sha256:"); err == nil && ok && !strings.EqualFold(hex.EncodeToString(h.Sum(nil)), want) {
		err = errors.New("checksum mismatch, the download is damaged")
	}
	if err != nil {
		os.Remove(path)
		return "", err
	}
	return path, nil
}

func (s *server) handleUpdate(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, checkUpdate(r.Context(), r.URL.Query().Get("force") == "1"))
}

// handleUpdateInstall downloads the new installer, starts it in update mode
// and quits, so the installer can replace spline.exe and start it again.
func (s *server) handleUpdateInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	info := checkUpdate(r.Context(), false)
	if !info.Available || !info.Installed || info.installer.URL == "" {
		http.Error(w, "no update to install", http.StatusConflict)
		return
	}
	path, err := downloadInstaller(r.Context(), info.installer)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	if err := startInstaller(path); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"status": "installing"})
	go func() { time.Sleep(700 * time.Millisecond); os.Exit(0) }()
}

// handleOpenPage opens one of Spline's web pages in the default browser.
func (s *server) handleOpenPage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	pages := map[string]string{
		"github":   "https://github.com/" + repo,
		"releases": releasesPage,
		"issues":   "https://github.com/" + repo + "/issues",
	}
	page, ok := pages[r.URL.Query().Get("page")]
	if !ok {
		http.Error(w, "unknown page", http.StatusBadRequest)
		return
	}
	openBrowser(page)
	w.WriteHeader(http.StatusNoContent)
}
