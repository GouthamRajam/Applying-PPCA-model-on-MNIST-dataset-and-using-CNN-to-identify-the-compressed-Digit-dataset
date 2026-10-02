//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"
)

// openWindow opens the page as an app window (no tabs or address bar) in Edge, or Chrome,
// with Gothysis's own browser profile; otherwise in the default browser.
func openWindow(url string) {
	var cands []string
	for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"} {
		if b := os.Getenv(env); b != "" {
			cands = append(cands, filepath.Join(b, `Microsoft\Edge\Application\msedge.exe`),
				filepath.Join(b, `Google\Chrome\Application\chrome.exe`))
		}
	}
	for _, exe := range cands {
		if _, err := os.Stat(exe); err == nil {
			prof := filepath.Join(dataDir(), "window")
			if exec.Command(exe, "--app="+url, "--user-data-dir="+prof, "--no-first-run",
				"--no-default-browser-check", "--window-size=1440,920").Start() == nil {
				return
			}
		}
	}
	c := exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	c.Start()
}

func fatal(format string, a ...any) {
	msg, _ := syscall.UTF16PtrFromString(fmt.Sprintf(format, a...))
	title, _ := syscall.UTF16PtrFromString("Gothysis")
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0,
		uintptr(unsafe.Pointer(msg)), uintptr(unsafe.Pointer(title)), 0x10)
	os.Exit(1)
}
