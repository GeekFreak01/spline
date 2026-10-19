//go:build !windows

package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

const canInstallFonts = runtime.GOOS == "darwin" || runtime.GOOS == "linux"

// installFont copies the font to the user's font folder, replacing an
// earlier install of the same font.
func installFont(data []byte, fullName, fileName string) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	var dir string
	switch runtime.GOOS {
	case "darwin":
		dir = filepath.Join(home, "Library", "Fonts")
	case "linux":
		dir = filepath.Join(home, ".local", "share", "fonts")
	default:
		return "", errors.New("installing fonts is not supported on this system")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(dir, fileName+".ttf")
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return "", err
	}
	if runtime.GOOS == "linux" {
		exec.Command("fc-cache", "-f", dir).Run()
	}
	return path, nil
}
