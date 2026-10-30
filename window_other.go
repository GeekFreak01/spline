//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
)

// openWindow opens the editor as a standalone app window of Chrome, Edge or
// Chromium (no tabs or address bar). The browser runs on its own, so the
// call never blocks: blocked is always false.
func openWindow(url string) (opened, blocked bool) {
	if runtime.GOOS == "darwin" {
		for _, app := range []string{"Google Chrome", "Microsoft Edge", "Chromium", "Brave Browser"} {
			if exec.Command("open", "-Ra", app).Run() == nil {
				return exec.Command("open", "-na", app, "--args", "--app="+url).Start() == nil, false
			}
		}
		return false, false
	}
	for _, name := range []string{"google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"} {
		if path, err := exec.LookPath(name); err == nil {
			return exec.Command(path, "--app="+url).Start() == nil, false
		}
	}
	return false, false
}

// fatal reports an error that stops the program (in a terminal here).
func fatal(msg string) {
	fmt.Fprintln(os.Stderr, msg)
	os.Exit(1)
}
