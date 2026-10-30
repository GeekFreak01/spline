package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
)

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

func TestPickAsset(t *testing.T) {
	assets := []releaseAsset{{Name: "spline-linux-amd64"}, {Name: "spline-macos-arm64"}, {Name: "spline-windows-amd64.exe"}, {Name: "Spline-Setup-0.41.0.exe"}}
	cases := []struct {
		setup        bool
		goos, goarch string
		want         string
	}{
		{true, "windows", "amd64", "Spline-Setup-0.41.0.exe"},
		{false, "windows", "amd64", "spline-windows-amd64.exe"},
		{false, "darwin", "arm64", "spline-macos-arm64"},
		{false, "linux", "amd64", "spline-linux-amd64"},
		{false, "linux", "arm64", ""},
	}
	for _, c := range cases {
		if a, _ := pickAsset(assets, c.setup, c.goos, c.goarch); a.Name != c.want {
			t.Errorf("pickAsset(%v, %s, %s) = %q, want %q", c.setup, c.goos, c.goarch, a.Name, c.want)
		}
	}
}

func TestUsableAsset(t *testing.T) {
	sum := "sha256:" + strings.Repeat("a", 64)
	good := releaseAsset{Name: "spline-linux-amd64", URL: assetBase + "v1.0.0/spline-linux-amd64", Size: 100, Digest: sum}
	if !good.usable() {
		t.Error("a release file is refused")
	}
	bad := map[string]func(a *releaseAsset){
		"other repository": func(a *releaseAsset) { a.URL = "https://github.com/someone/spline/releases/download/v1.0.0/x" },
		"other host":       func(a *releaseAsset) { a.URL = "https://example.com/" + a.Name },
		"path up":          func(a *releaseAsset) { a.URL = assetBase + "../../evil" },
		"no checksum":      func(a *releaseAsset) { a.Digest = "" },
		"short checksum":   func(a *releaseAsset) { a.Digest = "sha256:abc" },
		"empty":            func(a *releaseAsset) { a.Size = 0 },
		"huge":             func(a *releaseAsset) { a.Size = maxAssetSize + 1 },
		"name with folder": func(a *releaseAsset) { a.Name = "../spline" },
	}
	for name, change := range bad {
		a := good
		change(&a)
		if a.usable() {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestShortNotes(t *testing.T) {
	got := shortNotes("## Что нового\n\nПравки\n\n## Скачать · Download\n\n- ссылки")
	if strings.Contains(got, "ссылки") || !strings.Contains(got, "Правки") {
		t.Errorf("notes: %q", got)
	}
	if long := shortNotes(strings.Repeat("я", maxNotesSize)); !utf8.ValidString(long) || len(long) > maxNotesSize+4 {
		t.Errorf("long notes: %d bytes", len(long))
	}
}

func TestDownloadAsset(t *testing.T) {
	body := []byte("the new program")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(body) }))
	defer srv.Close()
	sum := sha256.Sum256(body)
	good := releaseAsset{Name: "spline", URL: srv.URL + "/spline", Size: int64(len(body)), Digest: "sha256:" + hex.EncodeToString(sum[:])}
	dir := t.TempDir()
	path, err := downloadAsset(context.Background(), good, dir)
	if err != nil {
		t.Fatal(err)
	}
	if data, _ := os.ReadFile(path); !bytes.Equal(data, body) {
		t.Errorf("downloaded %q", data)
	}
	damaged := good
	damaged.Digest = "sha256:" + strings.Repeat("0", 64)
	if _, err := downloadAsset(context.Background(), damaged, dir); err == nil {
		t.Error("a damaged download is accepted")
	}
	short := good
	short.Size++
	if _, err := downloadAsset(context.Background(), short, dir); err == nil {
		t.Error("an incomplete download is accepted")
	}
	if _, err := os.Stat(filepath.Join(dir, "spline")); err == nil {
		t.Error("a bad download stays on disk")
	}
}

func TestSwapProgram(t *testing.T) {
	dir := t.TempDir()
	exe, fresh := filepath.Join(dir, "spline"), filepath.Join(dir, "fresh")
	os.WriteFile(exe, []byte("old"), 0o755)
	os.WriteFile(fresh, []byte("new"), 0o755)
	if err := swapProgram(exe, fresh); err != nil {
		t.Fatal(err)
	}
	if data, _ := os.ReadFile(exe); string(data) != "new" {
		t.Errorf("program is %q", data)
	}
	if data, _ := os.ReadFile(exe + ".old"); string(data) != "old" {
		t.Errorf("old copy is %q", data)
	}
	if _, err := os.Stat(exe + ".new"); err == nil {
		t.Error("the temporary file stays")
	}
	// Nothing to copy: the program stays as it was.
	if err := swapProgram(exe, filepath.Join(dir, "missing")); err == nil {
		t.Error("a missing file is accepted")
	}
	if data, _ := os.ReadFile(exe); string(data) != "new" {
		t.Errorf("after a failure the program is %q", data)
	}
}

func TestInstallerArgs(t *testing.T) {
	root := filepath.Join(t.TempDir(), "Program Files")
	t.Setenv("ProgramFiles", root)
	t.Setenv("ProgramFiles(x86)", "")
	t.Setenv("ProgramW6432", "")
	has := func(args []string, want string) bool {
		return strings.Contains(strings.Join(args, "\n")+"\n", want+"\n")
	}

	forAll := installerArgs(filepath.Join(root, "Spline", "spline.exe"), `C:\шрифты\мой шрифт.sp`, 7880)
	if !has(forAll, "/ALLUSERS") || !has(forAll, "/RELAUNCH") || !has(forAll, "/PORT=7880") || !has(forAll, `/OPEN=C:\шрифты\мой шрифт.sp`) {
		t.Errorf("all users: %q", forAll)
	}
	forMe := installerArgs(`C:\Users\me\AppData\Local\Programs\Spline\spline.exe`, "", 7878)
	if has(forMe, "/ALLUSERS") || strings.Contains(strings.Join(forMe, " "), "/OPEN") {
		t.Errorf("current user: %q", forMe)
	}
}
