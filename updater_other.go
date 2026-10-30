//go:build !windows

package main

import "errors"

// Only Windows has an installer; elsewhere the program replaces itself.
func startInstaller(setup, exe, file string, port int) error {
	return errors.New("no installer on this system")
}
