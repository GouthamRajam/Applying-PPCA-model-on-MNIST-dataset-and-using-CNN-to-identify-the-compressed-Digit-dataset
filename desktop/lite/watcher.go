package main

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// FolderWatcher polls a folder for new or changed mission files and reports each one once its
// size has stopped changing (the vendor software may still be writing it). Polling also works
// on network and USB drives.
type FolderWatcher struct {
	Dir      string
	Interval time.Duration
	Exts     []string
	OnFile   func(name, path string)
	OnError  func(error)
	mu       sync.Mutex
	seen     map[string]string // name -> "mtime:size" already reported (or present at start)
	pending  map[string]string // name -> "mtime:size" seen once, waiting to be stable
	stop     chan struct{}
}

func NewFolderWatcher(dir string, interval time.Duration) *FolderWatcher {
	return &FolderWatcher{Dir: dir, Interval: interval, Exts: []string{".csv", ".txt"},
		OnFile: func(string, string) {}, OnError: func(error) {},
		seen: map[string]string{}, pending: map[string]string{}, stop: make(chan struct{})}
}

func (w *FolderWatcher) list() map[string]string {
	out := map[string]string{}
	ents, err := os.ReadDir(w.Dir)
	if err != nil {
		w.OnError(err)
		return out
	}
	for _, e := range ents {
		ext := strings.ToLower(filepath.Ext(e.Name()))
		ok := false
		for _, x := range w.Exts {
			ok = ok || x == ext
		}
		if !ok {
			continue
		}
		if st, err := e.Info(); err == nil && st.Mode().IsRegular() {
			out[e.Name()] = fmt.Sprintf("%d:%d", st.ModTime().UnixMilli(), st.Size())
		}
	}
	return out
}

func (w *FolderWatcher) Start() {
	// files already in the folder are history, not new missions
	for n, k := range w.list() {
		w.seen[n] = k
	}
	go func() {
		t := time.NewTicker(w.Interval)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				w.Poll()
			case <-w.stop:
				return
			}
		}
	}()
}

func (w *FolderWatcher) Poll() {
	var ready []string
	w.mu.Lock()
	for n, k := range w.list() {
		if w.seen[n] == k {
			continue
		}
		if w.pending[n] == k { // unchanged since last poll: finished writing
			delete(w.pending, n)
			w.seen[n] = k
			ready = append(ready, n)
		} else {
			w.pending[n] = k
		}
	}
	w.mu.Unlock()
	for _, n := range ready {
		w.OnFile(n, filepath.Join(w.Dir, n))
	}
}

// MarkSeen records the file's current state so a file Senson wrote itself is not reported.
func (w *FolderWatcher) MarkSeen(name string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if st, err := os.Stat(filepath.Join(w.Dir, name)); err == nil {
		w.seen[name] = fmt.Sprintf("%d:%d", st.ModTime().UnixMilli(), st.Size())
	}
}

func (w *FolderWatcher) Stop() { close(w.stop) }

// FoupLink: the FOUP's USB link shows up as a network adapter with an address in its subnet.
func FoupLink(prefix string) map[string]any {
	if prefix == "" {
		prefix = "192.168.10."
	}
	ifs, _ := net.Interfaces()
	for _, i := range ifs {
		if i.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := i.Addrs()
		for _, a := range addrs {
			if ipn, ok := a.(*net.IPNet); ok {
				if v4 := ipn.IP.To4(); v4 != nil && strings.HasPrefix(v4.String(), prefix) {
					return map[string]any{"up": true, "ifname": i.Name, "address": v4.String()}
				}
			}
		}
	}
	return map[string]any{"up": false}
}
