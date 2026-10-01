// Senson.exe (lightweight): serves the Senson page on 127.0.0.1 and opens it in an app window of
// Microsoft Edge (built into Windows 10/11), so no browser runtime has to be shipped.
// Same features as the Electron build: watches the mission-data folder, reports the USB/network
// link to the FOUP, saves exports. It never sends anything to the FOUP.
package main

import (
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const version = "1.0.0"
const port = 47613 // fixed so the page's saved data (localStorage) stays with the same origin

//go:embed app/index.html
var pageHTML string

//go:embed bridge.js
var bridgeJS string

type Settings map[string]any

var (
	mu       sync.Mutex
	settings Settings
	token    string
	watcher  *FolderWatcher
	clients  = map[chan [2]string]bool{}
	lastLink map[string]any
	lastSeen = time.Now()
)

func dataDir() string {
	d, err := os.UserConfigDir() // %APPDATA% on Windows
	if err != nil {
		d = "."
	}
	if v := os.Getenv("SENSON_USERDATA"); v != "" {
		return v
	}
	return filepath.Join(d, "Senson")
}

func defaults() Settings {
	lam := `C:\LAM SensArray`
	home, _ := os.UserHomeDir()
	inbox := filepath.Join(home, "Documents", "Senson Inbox")
	watch, export := inbox, inbox
	if isWindows {
		export = lam
		if st, err := os.Stat(lam); err == nil && st.IsDir() {
			watch = lam
		}
	}
	return Settings{"watchDir": watch, "exportDir": export, "mode": "ask", "foupPrefix": "192.168.10."}
}

func loadSettings() {
	settings = defaults()
	if b, err := os.ReadFile(filepath.Join(dataDir(), "settings.json")); err == nil {
		var s Settings
		if json.Unmarshal(b, &s) == nil {
			for k, v := range s {
				settings[k] = v
			}
		}
	}
}

func saveSettings() {
	os.MkdirAll(dataDir(), 0o755)
	b, _ := json.MarshalIndent(settings, "", "  ")
	os.WriteFile(filepath.Join(dataDir(), "settings.json"), b, 0o644)
}

func str(s Settings, k string) string { v, _ := s[k].(string); return v }

func broadcast(event string, data any) {
	b, _ := json.Marshal(data)
	mu.Lock()
	defer mu.Unlock()
	for c := range clients {
		select {
		case c <- [2]string{event, string(b)}:
		default:
		}
	}
}

func startWatcher() {
	mu.Lock()
	dir := str(settings, "watchDir")
	if watcher != nil {
		watcher.Stop()
	}
	os.MkdirAll(dir, 0o755)
	w := NewFolderWatcher(dir, 2*time.Second)
	watcher = w
	mu.Unlock()
	w.OnFile = func(name, path string) {
		b, err := os.ReadFile(path)
		if err != nil {
			broadcast("log", fmt.Sprintf("Could not read %s: %v", name, err))
			return
		}
		broadcast("mission", map[string]any{"name": name, "dir": dir, "path": path, "text": string(b)})
	}
	w.OnError = func(err error) { broadcast("log", "Watch folder not readable: "+err.Error()) }
	w.Start()
}

func linkLoop() {
	for {
		mu.Lock()
		prefix := str(settings, "foupPrefix")
		mu.Unlock()
		l := FoupLink(prefix)
		mu.Lock()
		changed := lastLink == nil || fmt.Sprint(lastLink) != fmt.Sprint(l)
		lastLink = l
		mu.Unlock()
		if changed {
			broadcast("link", l)
		}
		time.Sleep(3 * time.Second)
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

var unsafeName = regexp.MustCompile(`[<>:"/\\|?*]+`)

func api(w http.ResponseWriter, r *http.Request) {
	// Only the Senson page (which got the token) may call the API; blocks other local web pages.
	if r.Header.Get("X-Senson") != token && r.URL.Query().Get("t") != token {
		writeJSON(w, 403, map[string]string{"error": "forbidden"})
		return
	}
	switch r.URL.Path {
	case "/api/events":
		events(w, r)
	case "/api/settings":
		if r.Method == http.MethodPost {
			var s Settings
			if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
				writeJSON(w, 400, map[string]string{"error": err.Error()})
				return
			}
			mu.Lock()
			dirChanged := str(s, "watchDir") != "" && str(s, "watchDir") != str(settings, "watchDir")
			for k, v := range s {
				settings[k] = v
			}
			saveSettings()
			if _, ok := s["foupPrefix"]; ok {
				lastLink = nil
			}
			mu.Unlock()
			if dirChanged {
				startWatcher()
			}
		}
		mu.Lock()
		defer mu.Unlock()
		writeJSON(w, 200, settings)
	case "/api/pick-folder":
		var q struct{ Current string }
		json.NewDecoder(r.Body).Decode(&q)
		p, err := pickFolder(q.Current)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]string{"path": p})
	case "/api/save":
		var q struct{ Dir, Name, Text string }
		if err := json.NewDecoder(r.Body).Decode(&q); err != nil || q.Dir == "" || q.Name == "" {
			writeJSON(w, 400, map[string]string{"error": "dir and name are required"})
			return
		}
		name := unsafeName.ReplaceAllString(filepath.Base(q.Name), "-")
		os.MkdirAll(q.Dir, 0o755)
		p := filepath.Join(q.Dir, name)
		if err := os.WriteFile(p, []byte(q.Text), 0o644); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		mu.Lock()
		if watcher != nil && sameDir(q.Dir, watcher.Dir) { // our own export is not a new mission
			watcher.MarkSeen(name)
		}
		mu.Unlock()
		writeJSON(w, 200, map[string]string{"path": p})
	case "/api/version":
		writeJSON(w, 200, map[string]string{"version": version})
	default:
		writeJSON(w, 404, map[string]string{"error": "not found"})
	}
}

func sameDir(a, b string) bool {
	a, _ = filepath.Abs(a)
	b, _ = filepath.Abs(b)
	return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
}

func events(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", 500)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	c := make(chan [2]string, 32)
	mu.Lock()
	clients[c] = true
	cur := lastLink
	mu.Unlock()
	defer func() { mu.Lock(); delete(clients, c); lastSeen = time.Now(); mu.Unlock() }()
	if cur != nil {
		b, _ := json.Marshal(cur)
		fmt.Fprintf(w, "event: link\ndata: %s\n\n", b)
	}
	fl.Flush()
	tick := time.NewTicker(15 * time.Second)
	defer tick.Stop()
	for {
		select {
		case m := <-c:
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", m[0], m[1])
			fl.Flush()
		case <-tick.C:
			fmt.Fprint(w, ": ping\n\n")
			fl.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

func page(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	if r.URL.Query().Get("t") != token {
		http.Error(w, "Open Senson with Senson.exe.", 403)
		return
	}
	bridge := "<script>" + strings.Replace(bridgeJS, "__TOKEN__", token, 1) + "</script>"
	// The page is a body fragment (as published); give it a standards-mode document around it.
	html := `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
		`<meta name="viewport" content="width=device-width,initial-scale=1">` + bridge + "</head><body>" + pageHTML + "</body></html>"
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	fmt.Fprint(w, html)
}

type instance struct {
	Port  int    `json:"port"`
	Token string `json:"token"`
}

func instanceFile() string { return filepath.Join(dataDir(), "instance.json") }

func main() {
	loadSettings()
	os.MkdirAll(dataDir(), 0o755)
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		// Already running: just open another window on the running copy.
		var in instance
		if b, e := os.ReadFile(instanceFile()); e == nil && json.Unmarshal(b, &in) == nil {
			openWindow(fmt.Sprintf("http://127.0.0.1:%d/?t=%s", in.Port, in.Token))
			return
		}
		fatal("Senson could not start: port %d is in use.\n%v", port, err)
	}
	tb := make([]byte, 16)
	rand.Read(tb)
	token = hex.EncodeToString(tb)
	b, _ := json.Marshal(instance{port, token})
	os.WriteFile(instanceFile(), b, 0o600)

	mux := http.NewServeMux()
	mux.HandleFunc("/api/", api)
	mux.HandleFunc("/", page)
	go http.Serve(ln, mux)
	startWatcher()
	go linkLoop()

	url := fmt.Sprintf("http://127.0.0.1:%d/?t=%s", port, token)
	if os.Getenv("SENSON_NOBROWSER") != "" {
		fmt.Println("SENSON_URL " + url)
	} else {
		openWindow(url)
	}
	// Quit once no Senson window has been open for 20 s (60 s grace at start-up).
	start := time.Now()
	for {
		time.Sleep(2 * time.Second)
		mu.Lock()
		n, idle := len(clients), time.Since(lastSeen)
		mu.Unlock()
		if n == 0 && idle > 20*time.Second && time.Since(start) > 60*time.Second {
			os.Remove(instanceFile())
			return
		}
	}
}
