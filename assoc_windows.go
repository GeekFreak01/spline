//go:build windows

package main

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"golang.org/x/sys/windows/registry"
)

const progID = "Spline.Project"

const canAssociate = true

func exePath() (string, error) {
	p, err := os.Executable()
	if err != nil {
		return "", err
	}
	if r, err := filepath.EvalSymlinks(p); err == nil {
		p = r
	}
	return p, nil
}

// associated reports whether .sp files already open with this spline.exe.
func associated() bool {
	exe, err := exePath()
	if err != nil {
		return false
	}
	k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Classes\`+progID+`\shell\open\command`, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer k.Close()
	v, _, err := k.GetStringValue("")
	return err == nil && strings.Contains(strings.ToLower(v), strings.ToLower(exe))
}

// associate makes .sp files show the Spline document icon and open with
// this program. It only writes to HKEY_CURRENT_USER (no admin rights).
func associate() error {
	exe, err := exePath()
	if err != nil {
		return err
	}
	set := func(path, name, value string) error {
		k, _, err := registry.CreateKey(registry.CURRENT_USER, `Software\Classes\`+path, registry.SET_VALUE)
		if err != nil {
			return err
		}
		defer k.Close()
		return k.SetStringValue(name, value)
	}
	steps := []struct{ path, name, value string }{
		{".sp", "", progID},
		{".sp", "Content Type", "application/x-spline-project"},
		{progID, "", "Spline project"},
		{progID, "FriendlyTypeName", "Spline project"},
		{progID + `\DefaultIcon`, "", `"` + exe + `",-2`}, // icon resource 2
		{progID + `\shell\open\command`, "", `"` + exe + `" "%1"`},
	}
	for _, s := range steps {
		if err := set(s.path, s.name, s.value); err != nil {
			return err
		}
	}
	// Tell Explorer to refresh file icons (SHCNE_ASSOCCHANGED).
	shell32 := syscall.NewLazyDLL("shell32.dll")
	shell32.NewProc("SHChangeNotify").Call(0x08000000, 0, 0, 0)
	return nil
}
