package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
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
	Page      string `json:"page"`
	Error     string `json:"error,omitempty"`
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
		Tag  string `json:"tag_name"`
		Page string `json:"html_url"`
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
	updateCache, updateCached = info, time.Now()
	return info
}

func (s *server) handleUpdate(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, checkUpdate(r.Context(), r.URL.Query().Get("force") == "1"))
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
