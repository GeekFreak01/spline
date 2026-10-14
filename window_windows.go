//go:build windows

package main

import (
	"os"
	"path/filepath"

	webview2 "github.com/jchv/go-webview2"
)

// openWindow shows the editor in a native window (WebView2, built into
// Windows 10/11) and blocks until it is closed. opened is false when the
// WebView2 runtime is not available.
func openWindow(url string) (opened, blocked bool) {
	dataPath := ""
	if dir, err := os.UserCacheDir(); err == nil {
		dataPath = filepath.Join(dir, "Spline", "WebView2")
	}
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		AutoFocus: true,
		DataPath:  dataPath,
		WindowOptions: webview2.WindowOptions{
			Title:  "Spline",
			Width:  1440,
			Height: 900,
			Center: true,
			IconId: 1, // resource from rsrc_windows_*.syso
		},
	})
	if w == nil {
		return false, false
	}
	defer w.Destroy()
	// The page reports its title (font name, unsaved marker) to the window.
	w.Bind("splineSetTitle", func(title string) { w.SetTitle(title) })
	w.Navigate(url)
	w.Run()
	return true, true
}
