//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
)

func openWindow(url string) {
	for _, b := range []string{"microsoft-edge", "google-chrome", "chromium", "chromium-browser"} {
		if exec.Command(b, "--app="+url).Start() == nil {
			return
		}
	}
	exec.Command("xdg-open", url).Start()
}

func fatal(format string, a ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", a...)
	os.Exit(1)
}
