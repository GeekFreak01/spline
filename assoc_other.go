//go:build !windows

package main

import "errors"

// File associations are only set up by the program on Windows; on macOS
// and Linux they come from the app bundle / .desktop file.
const canAssociate = false

func associated() bool { return false }

func associate() error { return errors.New("not supported on this system") }
