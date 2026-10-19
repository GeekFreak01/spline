//go:build windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows/registry"
)

const canInstallFonts = true

var (
	gdi32                   = syscall.NewLazyDLL("gdi32.dll")
	procAddFontResourceW    = gdi32.NewProc("AddFontResourceW")
	procRemoveFontResourceW = gdi32.NewProc("RemoveFontResourceW")
)

const fontsKey = `Software\Microsoft\Windows NT\CurrentVersion\Fonts`

// installFont installs the font for the current user only (no admin rights
// needed, as Windows 10 1809+ does it). A font that is already installed
// under the same name is replaced. Each install gets a new file name: the
// old file may still be held open by running programs.
func installFont(data []byte, fullName, fileName string) (string, error) {
	dir := filepath.Join(os.Getenv("LOCALAPPDATA"), "Microsoft", "Windows", "Fonts")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	k, _, err := registry.CreateKey(registry.CURRENT_USER, fontsKey, registry.QUERY_VALUE|registry.SET_VALUE)
	if err != nil {
		return "", err
	}
	defer k.Close()
	value := fullName + " (TrueType)"
	if old, _, err := k.GetStringValue(value); err == nil && old != "" {
		if !filepath.IsAbs(old) {
			old = filepath.Join(dir, old)
		}
		callWide(procRemoveFontResourceW, old)
		os.Remove(old) // fails while some program uses it; that is fine
	}
	path := filepath.Join(dir, fmt.Sprintf("%s-%d.ttf", fileName, time.Now().Unix()))
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return "", err
	}
	if err := k.SetStringValue(value, path); err != nil {
		os.Remove(path)
		return "", err
	}
	if callWide(procAddFontResourceW, path) == 0 {
		return "", fmt.Errorf("Windows did not accept the font")
	}
	const hwndBroadcast, wmFontChange = 0xFFFF, 0x001D
	procPostMessageW.Call(hwndBroadcast, wmFontChange, 0, 0)
	return path, nil
}

func callWide(p *syscall.LazyProc, s string) uintptr {
	ptr, err := syscall.UTF16PtrFromString(s)
	if err != nil {
		return 0
	}
	r, _, _ := p.Call(uintptr(unsafe.Pointer(ptr)))
	return r
}
