package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/GeekFreak01/spline/internal/updatesig"
)

// A release installs only when SHA256SUMS.txt is signed with the Spline key
// for this very version and names the file being downloaded.
func TestVerifySigned(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	key := base64.StdEncoding.EncodeToString(pub)
	program := []byte("the new program")
	ps := sha256.Sum256(program)
	sums := []byte(hex.EncodeToString(ps[:]) + "  spline-linux-amd64\n")
	sign := func(tag string, k ed25519.PrivateKey) []byte {
		return []byte(base64.StdEncoding.EncodeToString(ed25519.Sign(k, updatesig.Message(tag, sums))) + "\n")
	}
	files := map[string][]byte{"/sums": sums, "/sig": sign("v9.0.0", priv)}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(files[r.URL.Path]) }))
	defer srv.Close()
	asset := func(path string) releaseAsset {
		b := files[path]
		s := sha256.Sum256(b)
		return releaseAsset{Name: path[1:], URL: srv.URL + path, Size: int64(len(b)), Digest: "sha256:" + hex.EncodeToString(s[:])}
	}
	info := func() *updateInfo {
		return &updateInfo{
			asset:      releaseAsset{Name: "spline-linux-amd64", Size: int64(len(program)), Digest: "sha256:" + hex.EncodeToString(ps[:])},
			sums:       asset("/sums"),
			sig:        asset("/sig"),
			releaseTag: "v9.0.0",
		}
	}
	ctx := context.Background()
	if err := verifySigned(ctx, info(), key); err != nil {
		t.Fatalf("a signed release is refused: %v", err)
	}
	old := info()
	old.releaseTag = "v9.1.0" // an old release passed off as a newer one
	if verifySigned(ctx, old, key) == nil {
		t.Error("the signature of another version is accepted")
	}
	other := info()
	other.asset.Name = "spline-windows-amd64.exe"
	if verifySigned(ctx, other, key) == nil {
		t.Error("a file missing from the checksums is accepted")
	}
	swapped := info()
	swapped.asset.Digest = "sha256:" + hex.EncodeToString(make([]byte, 32))
	if verifySigned(ctx, swapped, key) == nil {
		t.Error("a file that differs from the signed checksum is accepted")
	}
	_, stranger, _ := ed25519.GenerateKey(rand.Reader)
	files["/sig"] = sign("v9.0.0", stranger)
	if verifySigned(ctx, info(), key) == nil {
		t.Error("a release signed with another key is accepted")
	}
	if verifySigned(ctx, info(), "") == nil {
		t.Error("a copy without a key accepts a release")
	}
}
