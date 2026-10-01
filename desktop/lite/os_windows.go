//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

const isWindows = true

func hidden(c *exec.Cmd) *exec.Cmd {
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	return c
}

// openWindow opens the page as an app window (no tabs or address bar) in Edge, or Chrome,
// with Senson's own browser profile; otherwise in the default browser.
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
				"--no-default-browser-check", "--window-size=1500,950").Start() == nil {
				return
			}
		}
	}
	hidden(exec.Command("rundll32", "url.dll,FileProtocolHandler", url)).Start()
}

func pickFolder(current string) (string, error) {
	ps := `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog;` +
		`$d.Description = 'Choose a folder for Senson'; $d.ShowNewFolderButton = $true; $d.SelectedPath = $env:SENSON_CUR;` +
		`$f = New-Object System.Windows.Forms.Form; $f.TopMost = $true;` +
		`if ($d.ShowDialog($f) -eq 'OK') { [Console]::Out.Write($d.SelectedPath) }`
	c := hidden(exec.Command("powershell", "-NoProfile", "-STA", "-Command", ps))
	c.Env = append(os.Environ(), "SENSON_CUR="+current)
	out, err := c.Output()
	if err != nil {
		return "", fmt.Errorf("folder dialog failed: %v", err)
	}
	return strings.TrimSpace(string(out)), nil
}

func fatal(format string, a ...any) {
	msg, _ := syscall.UTF16PtrFromString(fmt.Sprintf(format, a...))
	title, _ := syscall.UTF16PtrFromString("Senson")
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0,
		uintptr(unsafe.Pointer(msg)), uintptr(unsafe.Pointer(title)), 0x10)
	os.Exit(1)
}
