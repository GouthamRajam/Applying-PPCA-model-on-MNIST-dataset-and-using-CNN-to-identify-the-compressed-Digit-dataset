//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
)

const isWindows = false

func openWindow(url string) {
	for _, b := range []string{"microsoft-edge", "google-chrome", "chromium", "chromium-browser"} {
		if exec.Command(b, "--app="+url).Start() == nil {
			return
		}
	}
	exec.Command("xdg-open", url).Start()
}

func pickFolder(current string) (string, error) {
	return "", fmt.Errorf("folder picker is only available on Windows; type the path instead")
}

func fatal(format string, a ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", a...)
	os.Exit(1)
}

func brandWindows() {}
