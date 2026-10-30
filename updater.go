package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
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
	maxAssetSize = 200 << 20
	maxNotesSize = 16 << 10
)

// Variables only so that a test build can aim them at a local server
// (go build -ldflags -X): nothing changes them at run time.
var (
	latestAPI = "https://api.github.com/repos/" + repo + "/releases/latest"
	assetBase = "https://github.com/" + repo + "/releases/download/"
)

type updateInfo struct {
	Current   string `json:"current"`
	Latest    string `json:"latest,omitempty"`
	Available bool   `json:"available"`
	Page      string `json:"page"`
	Notes     string `json:"notes,omitempty"`
	// CanInstall: this copy can replace itself; otherwise the release page
	// is offered.
	CanInstall bool   `json:"canInstall"`
	Error      string `json:"error,omitempty"`

	asset releaseAsset
}

type releaseAsset struct {
	Name   string `json:"name"`
	URL    string `json:"browser_download_url"`
	Size   int64  `json:"size"`
	Digest string `json:"digest"` // "sha256:<hex>", computed by GitHub
}

// updateJob is the one download at a time: it runs in the background, so
// the editor stays usable, and the page asks how far it got.
type updateJob struct {
	State string `json:"state"` // idle, downloading, ready, failed
	Done  int64  `json:"done"`
	Total int64  `json:"total"`
	Error string `json:"error,omitempty"`

	path  string
	asset releaseAsset
}

var (
	updateMu     sync.Mutex
	updateCache  *updateInfo
	updateCached time.Time
	jobMu        sync.Mutex
	job          = updateJob{State: "idle"}
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
func installedWithSetup(exe string) bool {
	if runtime.GOOS != "windows" {
		return false
	}
	_, err := os.Stat(filepath.Join(filepath.Dir(exe), "unins000.exe"))
	return err == nil
}

// binaryName is the release file of a copy that runs without an installer.
func binaryName(goos, goarch string) string {
	switch goos {
	case "windows":
		return "spline-windows-" + goarch + ".exe"
	case "darwin":
		return "spline-macos-" + goarch
	}
	return "spline-" + goos + "-" + goarch
}

// pickAsset chooses what replaces this copy: the installer for an installed
// Spline, the plain program otherwise.
func pickAsset(assets []releaseAsset, setup bool, goos, goarch string) (releaseAsset, bool) {
	for _, a := range assets {
		if setup && strings.HasPrefix(a.Name, "Spline-Setup-") && strings.HasSuffix(a.Name, ".exe") {
			return a, true
		}
		if !setup && a.Name == binaryName(goos, goarch) {
			return a, true
		}
	}
	return releaseAsset{}, false
}

// usable: a file we are willing to run. It comes from this project's own
// releases and carries GitHub's checksum.
func (a releaseAsset) usable() bool {
	return strings.HasPrefix(a.URL, assetBase) && !strings.Contains(a.URL, "..") &&
		a.Size > 0 && a.Size <= maxAssetSize && a.Name == filepath.Base(a.Name) &&
		sha256Of(a) != ""
}

func sha256Of(a releaseAsset) string {
	hexsum, ok := strings.CutPrefix(a.Digest, "sha256:")
	if !ok || len(hexsum) != sha256.Size*2 {
		return ""
	}
	return strings.ToLower(hexsum)
}

// writable: a new program can be put next to the old one.
func writable(dir string) bool {
	f, err := os.CreateTemp(dir, ".spline-update-*")
	if err != nil {
		return false
	}
	f.Close()
	os.Remove(f.Name())
	return true
}

// canReplace: installers ask for the rights they need, a plain program must
// sit in a folder we can write to.
func canReplace(exe string, setup bool) bool {
	return setup || writable(filepath.Dir(exe))
}

// shortNotes keeps "what is new" of a release description, not the download
// links that follow it.
func shortNotes(body string) string {
	for _, cut := range []string{"## Скачать", "## Download"} {
		if i := strings.Index(body, cut); i >= 0 {
			body = body[:i]
		}
	}
	body = strings.TrimSpace(strings.ToValidUTF8(body, ""))
	if len(body) > maxNotesSize {
		body = strings.ToValidUTF8(body[:maxNotesSize], "") + "…"
	}
	return body
}

func checkUpdate(ctx context.Context, force bool) *updateInfo {
	updateMu.Lock()
	defer updateMu.Unlock()
	if !force && updateCache != nil && time.Since(updateCached) < time.Hour {
		return updateCache
	}
	info := &updateInfo{Current: version, Page: releasesPage}
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
		Tag    string         `json:"tag_name"`
		Page   string         `json:"html_url"`
		Body   string         `json:"body"`
		Assets []releaseAsset `json:"assets"`
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
	info.Notes = shortNotes(rel.Body)
	if exe, err := os.Executable(); err == nil && info.Available {
		setup := installedWithSetup(exe)
		if a, ok := pickAsset(rel.Assets, setup, runtime.GOOS, runtime.GOARCH); ok && a.usable() && canReplace(exe, setup) {
			info.asset, info.CanInstall = a, true
		}
	}
	updateCache, updateCached = info, time.Now()
	return info
}

func (s *server) handleUpdate(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, checkUpdate(r.Context(), r.URL.Query().Get("force") == "1"))
}

// verifyFile compares a downloaded file with its published checksum.
func verifyFile(path string, a releaseAsset) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	h := sha256.New()
	n, err := io.Copy(h, f)
	if err != nil {
		return err
	}
	if n != a.Size {
		return fmt.Errorf("download is incomplete (%d of %d bytes)", n, a.Size)
	}
	if hex.EncodeToString(h.Sum(nil)) != sha256Of(a) {
		return errors.New("checksum mismatch, the download is damaged")
	}
	return nil
}

// progressWriter tells the job how many bytes have arrived.
type progressWriter struct{ done int64 }

func (p *progressWriter) Write(b []byte) (int, error) {
	p.done += int64(len(b))
	jobMu.Lock()
	job.Done = p.done
	jobMu.Unlock()
	return len(b), nil
}

// downloadAsset fetches a release file into dir and checks it.
func downloadAsset(ctx context.Context, a releaseAsset, dir string) (string, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, a.URL, nil)
	req.Header.Set("User-Agent", "Spline/"+version)
	resp, err := (&http.Client{Timeout: 15 * time.Minute}).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", errors.New(resp.Status)
	}
	path := filepath.Join(dir, a.Name)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o700)
	if err != nil {
		return "", err
	}
	_, err = io.Copy(io.MultiWriter(f, &progressWriter{}), io.LimitReader(resp.Body, a.Size+1))
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = verifyFile(path, a)
	}
	if err != nil {
		os.Remove(path)
		return "", err
	}
	return path, nil
}

// handleUpdateDownload starts fetching the new version in the background.
func (s *server) handleUpdateDownload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	info := checkUpdate(r.Context(), false)
	if !info.Available || !info.CanInstall {
		http.Error(w, "no update to install", http.StatusConflict)
		return
	}
	jobMu.Lock()
	defer jobMu.Unlock()
	if job.State == "downloading" || job.State == "ready" {
		writeJSON(w, job)
		return
	}
	job = updateJob{State: "downloading", Total: info.asset.Size, asset: info.asset}
	go func(a releaseAsset) {
		dir, err := os.UserCacheDir()
		var path string
		if err == nil {
			path, err = downloadAsset(context.Background(), a, filepath.Join(dir, "Spline", "update"))
		}
		jobMu.Lock()
		defer jobMu.Unlock()
		if err != nil {
			job.State, job.Error = "failed", err.Error()
			return
		}
		job.State, job.path = "ready", path
	}(info.asset)
	writeJSON(w, job)
}

func (s *server) handleUpdateStatus(w http.ResponseWriter, r *http.Request) {
	jobMu.Lock()
	defer jobMu.Unlock()
	writeJSON(w, job)
}

// otherWindows counts other copies of Spline on this computer. The installer
// closes every running copy, so they must not hold unsaved work.
func (s *server) otherWindows() int {
	n := 0
	client := &http.Client{Timeout: 300 * time.Millisecond}
	for p := 7878; p < 7898; p++ {
		if p == s.port {
			continue
		}
		c, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", p), 100*time.Millisecond)
		if err != nil {
			continue
		}
		c.Close()
		resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/api/session", p))
		if err != nil {
			continue
		}
		var info sessionInfo
		err = json.NewDecoder(io.LimitReader(resp.Body, 64<<20)).Decode(&info)
		resp.Body.Close()
		if err == nil && info.Version != "" {
			n++
		}
	}
	return n
}

// swapProgram puts the new program in place of the running one. A running
// program cannot be overwritten on Windows but can be renamed, and the old
// copy is deleted at the next start. A failure leaves the old program.
func swapProgram(exe, fresh string) error {
	tmp := exe + ".new"
	if err := copyFile(fresh, tmp); err != nil {
		return err
	}
	defer os.Remove(tmp)
	old := exe + ".old"
	os.Remove(old)
	if err := os.Rename(exe, old); err != nil {
		return err
	}
	if err := os.Rename(tmp, exe); err != nil {
		os.Rename(old, exe)
		return err
	}
	return nil
}

func copyFile(from, to string) error {
	in, err := os.Open(from)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(to, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	if _, err = io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(to)
		return err
	}
	return out.Close()
}

// cleanupUpdate removes what the update left behind, once the old copy has
// let go of its file.
func cleanupUpdate() {
	if dir, err := os.UserCacheDir(); err == nil {
		os.RemoveAll(filepath.Join(dir, "Spline", "update"))
	}
	exe, err := os.Executable()
	if err != nil {
		return
	}
	for i := 0; i < 50; i++ {
		if err := os.Remove(exe + ".old"); err == nil || errors.Is(err, os.ErrNotExist) {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
}

// handleUpdateApply replaces this copy with the downloaded version and starts
// it with the same file. The page has already saved the work.
func (s *server) handleUpdateApply(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	jobMu.Lock()
	state, path, a := job.State, job.path, job.asset
	jobMu.Unlock()
	if state != "ready" {
		http.Error(w, "the update is not downloaded", http.StatusConflict)
		return
	}
	exe, err := os.Executable()
	if err == nil {
		err = verifyFile(path, a)
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	setup := installedWithSetup(exe)
	if setup {
		if n := s.otherWindows(); n > 0 {
			http.Error(w, strconv.Itoa(n), http.StatusLocked)
			return
		}
	}
	s.mu.Lock()
	file := s.filePath
	s.mu.Unlock()
	if setup {
		err = startInstaller(path, exe, file, s.port)
	} else {
		err = restartWith(exe, path, file, s.port)
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"status": "restarting"})
	go func() { time.Sleep(300 * time.Millisecond); os.Exit(0) }()
}

// installerArgs: update mode shows only progress, keeps the folder and
// options, and starts Spline again. An "all users" copy needs /ALLUSERS,
// or the update would make a second copy for the current user.
func installerArgs(exe, file string, port int) []string {
	args := []string{"/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/RELAUNCH", fmt.Sprintf("/PORT=%d", port)}
	if file != "" {
		args = append(args, "/OPEN="+file)
	}
	for _, env := range []string{"ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"} {
		if dir := os.Getenv(env); dir != "" && strings.HasPrefix(strings.ToLower(exe), strings.ToLower(dir+string(filepath.Separator))) {
			return append(args, "/ALLUSERS")
		}
	}
	return args
}

// restartWith swaps the program and starts the new one, which waits for this
// copy's port.
func restartWith(exe, fresh, file string, port int) error {
	if err := swapProgram(exe, fresh); err != nil {
		return err
	}
	args := []string{"--restarted", "--port", strconv.Itoa(port)}
	if file != "" {
		args = append(args, file)
	}
	if err := exec.Command(exe, args...).Start(); err != nil {
		os.Rename(exe+".old", exe) // the old copy keeps working
		return err
	}
	return nil
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
	// The guide is a page of the app itself, in the browser.
	lang := r.URL.Query().Get("lang")
	if lang != "en" {
		lang = "ru"
	}
	pages["guide"] = fmt.Sprintf("http://127.0.0.1:%d/guide.html?lang=%s", s.port, lang)
	page, ok := pages[r.URL.Query().Get("page")]
	if !ok {
		http.Error(w, "unknown page", http.StatusBadRequest)
		return
	}
	openBrowser(page)
	w.WriteHeader(http.StatusNoContent)
}
