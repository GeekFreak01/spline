//go:build windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
)

var (
	user32                       = syscall.NewLazyDLL("user32.dll")
	dwmapi                       = syscall.NewLazyDLL("dwmapi.dll")
	procSetWindowLongPtrW        = user32.NewProc("SetWindowLongPtrW")
	procCallWindowProcW          = user32.NewProc("CallWindowProcW")
	procSetWindowPos             = user32.NewProc("SetWindowPos")
	procReleaseCapture           = user32.NewProc("ReleaseCapture")
	procPostMessageW             = user32.NewProc("PostMessageW")
	procSendMessageW             = user32.NewProc("SendMessageW")
	procShowWindow               = user32.NewProc("ShowWindow")
	procIsZoomed                 = user32.NewProc("IsZoomed")
	procGetDpiForWindow          = user32.NewProc("GetDpiForWindow")
	procGetSystemMetricsForDpi   = user32.NewProc("GetSystemMetricsForDpi")
	procGetSystemMetrics         = user32.NewProc("GetSystemMetrics")
	procDwmExtendFrameIntoClient = dwmapi.NewProc("DwmExtendFrameIntoClientArea")
	procDwmSetWindowAttribute    = dwmapi.NewProc("DwmSetWindowAttribute")
)

const (
	gwlpWndProc       = ^uintptr(3) // -4
	wmNCCalcSize      = 0x0083
	wmNCLButtonDown   = 0x00A1
	wmClose           = 0x0010
	wmSize            = 0x0005
	swMinimize        = 6
	swMaximize        = 3
	swRestore         = 9
	swpFrameChanged   = 0x0020
	swpNoMove         = 0x0002
	swpNoSize         = 0x0001
	swpNoZOrder       = 0x0004
	smCXFrame         = 32
	smCYFrame         = 33
	smCXPaddedBorder  = 92
	dwmwaCornerPref   = 33
	dwmwcpRound       = 2
	htCaption         = 2
	defaultWindowDPI  = 96
	minWindowWidth    = 900
	minWindowHeight   = 560
	initialWidth      = 1440
	initialHeight     = 900
	resourceAppIconID = 1 // from rsrc_windows_*.syso
)

type rect struct{ left, top, right, bottom int32 }

type ncCalcSizeParams struct {
	rgrc  [3]rect
	lppos uintptr
}

var (
	oldWndProc uintptr
	newWndProc = syscall.NewCallback(framelessWndProc)

	askClose     = func() {}
	closeAllowed bool
	closeAsked   time.Time // since when the page has not answered
)

const closeWait = 3 * time.Second

// framelessWndProc removes the system title bar and border: the whole window
// becomes client area, and the page draws its own title bar. The window
// keeps WS_THICKFRAME/WS_CAPTION, so shadow, snapping and animations work.
func framelessWndProc(hwnd, msg, wp, lp uintptr) uintptr {
	if msg == wmNCCalcSize && wp != 0 {
		if zoomed, _, _ := procIsZoomed.Call(hwnd); zoomed != 0 {
			// A maximized window is larger than the screen by its frame;
			// keep the content inside the visible area.
			p := *(**ncCalcSizeParams)(unsafe.Pointer(&lp)) // lParam points to NCCALCSIZE_PARAMS
			fx, fy := frameSize(hwnd)
			p.rgrc[0].left += fx
			p.rgrc[0].right -= fx
			p.rgrc[0].top += fy
			p.rgrc[0].bottom -= fy
		}
		return 0
	}
	// Closing goes through the page, which asks about unsaved work. A page
	// that does not answer must not keep the window open.
	if msg == wmClose && !closeAllowed && (closeAsked.IsZero() || time.Since(closeAsked) < closeWait) {
		if closeAsked.IsZero() {
			closeAsked = time.Now()
		}
		askClose()
		return 0
	}
	r, _, _ := procCallWindowProcW.Call(oldWndProc, hwnd, msg, wp, lp)
	return r
}

func frameSize(hwnd uintptr) (int32, int32) {
	metric := func(index uintptr) int32 {
		if procGetDpiForWindow.Find() == nil && procGetSystemMetricsForDpi.Find() == nil {
			dpi, _, _ := procGetDpiForWindow.Call(hwnd)
			if dpi == 0 {
				dpi = defaultWindowDPI
			}
			v, _, _ := procGetSystemMetricsForDpi.Call(index, dpi)
			return int32(v)
		}
		v, _, _ := procGetSystemMetrics.Call(index)
		return int32(v)
	}
	pad := metric(smCXPaddedBorder)
	return metric(smCXFrame) + pad, metric(smCYFrame) + pad
}

func makeFrameless(hwnd uintptr) {
	oldWndProc, _, _ = procSetWindowLongPtrW.Call(hwnd, gwlpWndProc, newWndProc)
	// A 1px DWM frame keeps the native drop shadow.
	margins := [4]int32{0, 0, 1, 0}
	procDwmExtendFrameIntoClient.Call(hwnd, uintptr(unsafe.Pointer(&margins)))
	pref := int32(dwmwcpRound) // rounded corners on Windows 11
	procDwmSetWindowAttribute.Call(hwnd, dwmwaCornerPref, uintptr(unsafe.Pointer(&pref)), 4)
	procSetWindowPos.Call(hwnd, 0, 0, 0, 0, 0, swpFrameChanged|swpNoMove|swpNoSize|swpNoZOrder)
	// The client area grew, but the size of the window did not change, so
	// no WM_SIZE arrives: send one so WebView2 fills the whole window.
	procSendMessageW.Call(hwnd, wmSize, 0, 0)
}

// windowAction is called by the page's title bar (window.splineWindow).
func windowAction(hwnd uintptr, action, arg string) string {
	zoomed := func() bool { z, _, _ := procIsZoomed.Call(hwnd); return z != 0 }
	switch action {
	case "minimize":
		procShowWindow.Call(hwnd, swMinimize)
	case "toggleMaximize":
		if zoomed() {
			procShowWindow.Call(hwnd, swRestore)
		} else {
			procShowWindow.Call(hwnd, swMaximize)
		}
	case "closeAsked":
		closeAsked = time.Time{}
	case "close":
		closeAllowed = true
		procPostMessageW.Call(hwnd, wmClose, 0, 0)
	case "drag", "resize":
		// Hand the mouse to Windows' own move/size loop, exactly as if the
		// user had grabbed the native title bar or border.
		hit := uintptr(htCaption)
		if action == "resize" {
			hit = map[string]uintptr{"w": 10, "e": 11, "n": 12, "nw": 13, "ne": 14, "s": 15, "sw": 16, "se": 17}[arg]
			if hit == 0 || zoomed() {
				return "ignored"
			}
		}
		procReleaseCapture.Call()
		procPostMessageW.Call(hwnd, wmNCLButtonDown, hit, 0)
	}
	if zoomed() {
		return "maximized"
	}
	return "normal"
}

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
			Width:  initialWidth,
			Height: initialHeight,
			Center: true,
			IconId: resourceAppIconID,
		},
	})
	if w == nil {
		return false, false
	}
	defer w.Destroy()
	hwnd := uintptr(w.Window())
	makeFrameless(hwnd)
	w.SetSize(minWindowWidth, minWindowHeight, webview2.HintMin)
	// The page reports its title (font name, unsaved marker) to the window.
	w.Bind("splineSetTitle", func(title string) { w.SetTitle(title) })
	w.Bind("splineWindow", func(action, arg string) string { return windowAction(hwnd, action, arg) })
	askClose = func() { w.Eval("window.splineCloseRequest?.()") }
	w.Navigate(url)
	w.Run()
	return true, true
}

var procMessageBoxW = user32.NewProc("MessageBoxW")

// fatal reports an error that stops the program. The Windows build has no
// console, so it is a message box, not a line nobody sees.
func fatal(msg string) {
	fmt.Fprintln(os.Stderr, msg)
	text, _ := syscall.UTF16PtrFromString(msg)
	title, _ := syscall.UTF16PtrFromString("Spline")
	const mbIconError = 0x10
	procMessageBoxW.Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), mbIconError)
	os.Exit(1)
}
