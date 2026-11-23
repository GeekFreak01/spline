// Command updatekey makes the release signing key and signs releases with it.
//
// Once, on the maintainer's computer, from the repository root:
//
//	go run ./tools/updatekey new
//
// It writes the secret key to a file in the home folder (never into the
// repository) and puts the public half into updatekey.go, which ships in
// the program. The secret goes into the SPLINE_SIGNING_KEY secret on GitHub.
//
// In the release workflow:
//
//	SPLINE_SIGNING_KEY=... go run ./tools/updatekey sign v1.2.3 release/SHA256SUMS.txt
//
// writes release/SHA256SUMS.txt.sig.
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/GeekFreak01/spline/internal/updatesig"
)

func main() {
	if len(os.Args) < 2 {
		fail("usage: updatekey new | updatekey sign <tag> <SHA256SUMS.txt>")
	}
	switch os.Args[1] {
	case "new":
		newKey()
	case "sign":
		if len(os.Args) != 4 {
			fail("usage: updatekey sign <tag> <SHA256SUMS.txt>")
		}
		sign(os.Args[2], os.Args[3])
	default:
		fail("unknown command " + os.Args[1])
	}
}

func fail(msg string) {
	fmt.Fprintln(os.Stderr, msg)
	os.Exit(1)
}

func newKey() {
	home, err := os.UserHomeDir()
	if err != nil {
		fail(err.Error())
	}
	keyFile := filepath.Join(home, "spline-signing-key.txt")
	if _, err := os.Stat(keyFile); err == nil {
		fail(keyFile + " already exists: a new key would lock out every copy that trusts the old one")
	}
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		fail(err.Error())
	}
	src, err := os.ReadFile("updatekey.go")
	if err != nil {
		fail("run it from the repository root: " + err.Error())
	}
	re := regexp.MustCompile(`updatePublicKey = "[^"]*"`)
	if !re.Match(src) {
		fail("updatekey.go has no updatePublicKey line")
	}
	if err := os.WriteFile(keyFile, []byte(base64.StdEncoding.EncodeToString(priv)+"\n"), 0o600); err != nil {
		fail(err.Error())
	}
	out := re.ReplaceAll(src, []byte(`updatePublicKey = "`+base64.StdEncoding.EncodeToString(pub)+`"`))
	if err := os.WriteFile("updatekey.go", out, 0o644); err != nil {
		fail(err.Error())
	}
	fmt.Println("Secret key:  " + keyFile)
	fmt.Println("Public key:  written into updatekey.go")
}

func sign(tag, sumsFile string) {
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(os.Getenv("SPLINE_SIGNING_KEY")))
	if err != nil || len(raw) != ed25519.PrivateKeySize {
		fail("SPLINE_SIGNING_KEY is missing or not a key made by updatekey new")
	}
	sums, err := os.ReadFile(sumsFile)
	if err != nil {
		fail(err.Error())
	}
	sig := ed25519.Sign(ed25519.PrivateKey(raw), updatesig.Message(tag, sums))
	// The secret must match the public key the program ships with, or no
	// copy could install this release: stop here instead.
	src, err := os.ReadFile("updatekey.go")
	if err != nil {
		fail("run it from the repository root: " + err.Error())
	}
	m := regexp.MustCompile(`updatePublicKey = "([^"]*)"`).FindSubmatch(src)
	if m == nil {
		fail("updatekey.go has no updatePublicKey line")
	}
	pub, err := base64.StdEncoding.DecodeString(string(m[1]))
	if err != nil || len(pub) != ed25519.PublicKeySize || !ed25519.Verify(ed25519.PublicKey(pub), updatesig.Message(tag, sums), sig) {
		fail("SPLINE_SIGNING_KEY does not match the public key in updatekey.go")
	}
	if err := os.WriteFile(sumsFile+".sig", []byte(base64.StdEncoding.EncodeToString(sig)+"\n"), 0o644); err != nil {
		fail(err.Error())
	}
}
