//go:build !windows

package main

import "errors"

// Self-update uses the Windows installer; other systems get the release page.
func startInstaller(string) error { return errors.New("not supported on this system") }
