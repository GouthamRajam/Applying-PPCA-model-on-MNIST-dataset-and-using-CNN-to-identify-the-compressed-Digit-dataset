// Gothysis.exe: serves the Gothysis page (app/, embedded in the exe) on 127.0.0.1 and opens it in an
// app window of Microsoft Edge, which is part of Windows 10/11, so no browser runtime is shipped.
// All analysis runs in the page; data never leaves the computer. The exe quits about 20 seconds
// after its last window closes.
package main

import (
	"embed"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const version = "1.0.0"
const port = 47631 // fixed, so the window's saved settings (theme) stay with the same origin

//go:embed app
var appFiles embed.FS

var (
	mu       sync.Mutex
	clients  int
	lastSeen = time.Now()
)

func dataDir() string {
	if v := os.Getenv("GOTHYSIS_USERDATA"); v != "" {
		return v
	}
	d, err := os.UserCacheDir() // %LOCALAPPDATA% on Windows
	if err != nil {
		d = os.TempDir()
	}
	return filepath.Join(d, "Gothysis")
}

// alive is an event stream the page keeps open; when none is open the window is closed.
func alive(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", 500)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	mu.Lock()
	clients++
	mu.Unlock()
	defer func() { mu.Lock(); clients--; lastSeen = time.Now(); mu.Unlock() }()
	fmt.Fprint(w, ": hello\n\n")
	fl.Flush()
	tick := time.NewTicker(15 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-tick.C:
			fmt.Fprint(w, ": ping\n\n")
			fl.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

func handler() http.Handler {
	sub, _ := fs.Sub(appFiles, "app")
	files := http.FileServer(http.FS(sub))
	mux := http.NewServeMux()
	mux.HandleFunc("/api/alive", alive)
	mux.HandleFunc("/api/version", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"name":"Gothysis","version":%q}`, version)
	})
	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		files.ServeHTTP(w, r)
	}))
	return mux
}

func main() {
	os.MkdirAll(dataDir(), 0o755)
	url := fmt.Sprintf("http://127.0.0.1:%d/", port)
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		// Already running: open another window on the running copy.
		if resp, e := http.Get(url + "api/version"); e == nil {
			resp.Body.Close()
			openWindow(url)
			return
		}
		fatal("Gothysis could not start: port %d is in use by another program.\n%v", port, err)
	}
	go http.Serve(ln, handler())
	if os.Getenv("GOTHYSIS_NOBROWSER") != "" {
		fmt.Println("GOTHYSIS_URL " + url)
	} else {
		openWindow(url)
	}
	// Quit once no window has been open for 20 s (60 s grace at start-up).
	start := time.Now()
	for {
		time.Sleep(2 * time.Second)
		mu.Lock()
		n, idle := clients, time.Since(lastSeen)
		mu.Unlock()
		if n == 0 && idle > 20*time.Second && time.Since(start) > 60*time.Second {
			return
		}
	}
}
