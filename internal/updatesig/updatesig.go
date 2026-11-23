// Package updatesig is what a release signature covers, shared by the
// signing tool and the updater.
package updatesig

import (
	"bufio"
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"strings"
)

// Message binds the checksums to the version, so the files of an old
// release can't be passed off as a new one.
func Message(tag string, sums []byte) []byte {
	return append([]byte("Spline release "+tag+"\n"), sums...)
}

// Checksum returns the sha256 that the signed SHA256SUMS.txt gives for
// name, after checking the signature with the public key (base64).
func Checksum(publicKey, tag string, sums, sig []byte, name string) (string, error) {
	pub, err := base64.StdEncoding.DecodeString(publicKey)
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return "", errors.New("this copy has no update key")
	}
	s, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(sig)))
	if err != nil || !ed25519.Verify(ed25519.PublicKey(pub), Message(tag, sums), s) {
		return "", errors.New("the release signature does not match")
	}
	sc := bufio.NewScanner(bytes.NewReader(sums))
	for sc.Scan() {
		// sha256sum: "<hex>  <name>", or "<hex> *<name>" in binary mode.
		sum, file, ok := strings.Cut(sc.Text(), " ")
		if ok && strings.TrimPrefix(strings.TrimPrefix(file, " "), "*") == name && len(sum) == 64 {
			return strings.ToLower(sum), nil
		}
	}
	return "", errors.New(name + " is not in the signed checksums")
}
