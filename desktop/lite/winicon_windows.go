//go:build windows

package main

import (
	"os"
	"runtime"
	"syscall"
	"time"
	"unsafe"
)

// Edge draws the Senson window, so by default Windows shows Edge's icon on it and groups it with
// Edge on the taskbar. brandWindows finds the Senson app window and gives it Senson's own icon
// (from this .exe's resources) and taskbar identity (AppUserModelID + relaunch properties), so the
// taskbar shows the Senson logo and pinning it starts Senson.exe.

var (
	user32                       = syscall.NewLazyDLL("user32.dll")
	shell32                      = syscall.NewLazyDLL("shell32.dll")
	ole32                        = syscall.NewLazyDLL("ole32.dll")
	kernel32                     = syscall.NewLazyDLL("kernel32.dll")
	pEnumWindows                 = user32.NewProc("EnumWindows")
	pGetWindowTextW              = user32.NewProc("GetWindowTextW")
	pGetClassNameW               = user32.NewProc("GetClassNameW")
	pIsWindowVisible             = user32.NewProc("IsWindowVisible")
	pSendMessageW                = user32.NewProc("SendMessageW")
	pLoadImageW                  = user32.NewProc("LoadImageW")
	pGetModuleHandleW            = kernel32.NewProc("GetModuleHandleW")
	pSHGetPropertyStoreForWindow = shell32.NewProc("SHGetPropertyStoreForWindow")
	pCoInitializeEx              = ole32.NewProc("CoInitializeEx")
)

const (
	wmSetIcon      = 0x0080
	iconSmall      = 0
	iconBig        = 1
	imageIcon      = 1
	lrShared       = 0x8000
	vtLPWSTR       = 31
	appUserModelID = "Senson.WaferAnalysis"
)

type guid struct {
	Data1 uint32
	Data2 uint16
	Data3 uint16
	Data4 [8]byte
}

type propertyKey struct {
	fmtid guid
	pid   uint32
}

type propVariant struct { // PROPVARIANT holding a VT_LPWSTR
	vt       uint16
	reserved [3]uint16
	val      uintptr
	pad      uintptr
}

// {9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3}: the System.AppUserModel property set.
var aumFmt = guid{0x9F4C2855, 0x9F79, 0x4B39, [8]byte{0xA8, 0xD0, 0xE1, 0xD4, 0x2D, 0xE1, 0xD5, 0xF3}}

// IID_IPropertyStore {886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99}
var iidPropertyStore = guid{0x886D8EEB, 0x8CF2, 0x4446, [8]byte{0x8D, 0x02, 0xCD, 0xBA, 0x1D, 0xBD, 0xCF, 0x99}}

func loadIcon(size int) uintptr {
	mod, _, _ := pGetModuleHandleW.Call(0)
	name, _ := syscall.UTF16PtrFromString("APP") // icon group written by go-winres (winres.json)
	h, _, _ := pLoadImageW.Call(mod, uintptr(unsafe.Pointer(name)), imageIcon, uintptr(size), uintptr(size), lrShared)
	return h
}

// iPropertyStore is a COM IPropertyStore: its first field points at the method table.
type iPropertyStore struct{ vtbl *[8]uintptr }

func setProp(store *iPropertyStore, pid uint32, value string) {
	s, _ := syscall.UTF16PtrFromString(value)
	key := propertyKey{aumFmt, pid}
	pv := propVariant{vt: vtLPWSTR, val: uintptr(unsafe.Pointer(s))}
	syscall.SyscallN(store.vtbl[6], uintptr(unsafe.Pointer(store)), uintptr(unsafe.Pointer(&key)), uintptr(unsafe.Pointer(&pv))) // SetValue
	runtime.KeepAlive(s)
	runtime.KeepAlive(&pv)
}

func setTaskbarIdentity(hwnd uintptr) {
	var store *iPropertyStore
	r, _, _ := pSHGetPropertyStoreForWindow.Call(hwnd, uintptr(unsafe.Pointer(&iidPropertyStore)), uintptr(unsafe.Pointer(&store)))
	if r != 0 || store == nil {
		return
	}
	exe, _ := os.Executable()
	// Relaunch properties first; Windows uses them once the ID is set.
	setProp(store, 2, `"`+exe+`"`) // RelaunchCommand
	setProp(store, 3, exe+",0")    // RelaunchIconResource
	setProp(store, 4, "Senson")    // RelaunchDisplayNameResource
	setProp(store, 5, appUserModelID)
	self := uintptr(unsafe.Pointer(store))
	syscall.SyscallN(store.vtbl[7], self) // Commit
	syscall.SyscallN(store.vtbl[2], self) // Release
}

func windowText(proc *syscall.LazyProc, hwnd uintptr) string {
	buf := make([]uint16, 128)
	proc.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	return syscall.UTF16ToString(buf)
}

func brandWindows() {
	runtime.LockOSThread()
	pCoInitializeEx.Call(0, 2) // COINIT_APARTMENTTHREADED
	small, big := loadIcon(16), loadIcon(32)
	branded := map[uintptr]bool{}
	cb := syscall.NewCallback(func(hwnd, _ uintptr) uintptr {
		if v, _, _ := pIsWindowVisible.Call(hwnd); v == 0 {
			return 1
		}
		// Only Chromium app windows titled exactly "Senson" (a browser tab would be "Senson - Microsoft Edge").
		if windowText(pGetClassNameW, hwnd) != "Chrome_WidgetWin_1" || windowText(pGetWindowTextW, hwnd) != "Senson" {
			return 1
		}
		if !branded[hwnd] {
			branded[hwnd] = true
			setTaskbarIdentity(hwnd)
		}
		// Re-applied each pass: Edge resets the window icon when the page reloads.
		if small != 0 {
			pSendMessageW.Call(hwnd, wmSetIcon, iconSmall, small)
		}
		if big != 0 {
			pSendMessageW.Call(hwnd, wmSetIcon, iconBig, big)
		}
		return 1
	})
	for {
		pEnumWindows.Call(cb, 0)
		time.Sleep(time.Second)
	}
}
