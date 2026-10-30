//go:build windows

package main

import "os/exec"

// startInstaller runs the new setup program, which outlives this copy.
func startInstaller(setup, exe, file string, port int) error {
	return exec.Command(setup, installerArgs(exe, file, port)...).Start()
}
