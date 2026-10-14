//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

// startInstaller runs the downloaded setup in update mode: no questions,
// same folder and options as before, and /RELAUNCH starts Spline again.
func startInstaller(path string) error {
	cmd := exec.Command(path, "/SILENT", "/SP-", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS", "/RELAUNCH")
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x00000008} // DETACHED_PROCESS
	return cmd.Start()
}
