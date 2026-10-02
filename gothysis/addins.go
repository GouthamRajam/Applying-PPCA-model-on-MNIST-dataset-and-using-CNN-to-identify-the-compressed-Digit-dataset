// Add-ins: .gaddin packages (a zip with addin.json and the add-in's script files) are installed
// into <dataDir>/addins/<id>/ and served to the page, which loads the enabled ones at start-up.
package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

const (
	addinAPIVersion   = 1
	maxAddinUpload    = 25 << 20  // bytes of the .gaddin file
	maxAddinUnpacked  = 100 << 20 // bytes after unzipping
	maxAddinFiles     = 500
	addinManifestName = "addin.json"
)

// Manifest is addin.json. Unknown fields are ignored.
type Manifest struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	Author      string `json:"author,omitempty"`
	Description string `json:"description,omitempty"`
	Main        string `json:"main"`
	APIVersion  int    `json:"apiVersion"`
	// Set by Gothysis, not by the package:
	Enabled bool `json:"enabled"`
}

var addinID = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{1,63}$`)

func addinsDir() string { return filepath.Join(dataDir(), "addins") }

func (m *Manifest) validate() error {
	switch {
	case !addinID.MatchString(m.ID):
		return errors.New(`addin.json: "id" must be 2-64 characters of lower-case letters, digits, ".", "_" or "-", e.g. "com.mycompany.capability"`)
	case strings.TrimSpace(m.Name) == "":
		return errors.New(`addin.json: "name" is required`)
	case strings.TrimSpace(m.Version) == "":
		return errors.New(`addin.json: "version" is required`)
	case m.Main == "" || !strings.HasSuffix(strings.ToLower(m.Main), ".js"):
		return errors.New(`addin.json: "main" must name the add-in's .js file`)
	case m.APIVersion < 1 || m.APIVersion > addinAPIVersion:
		return fmt.Errorf(`addin.json: "apiVersion" must be %d (this Gothysis supports add-in API version %d)`, addinAPIVersion, addinAPIVersion)
	}
	return nil
}

// cleanZipPath returns a safe relative path for a zip entry, or "" if the entry must be refused.
func cleanZipPath(name string) string {
	name = strings.ReplaceAll(name, "\\", "/")
	if strings.HasPrefix(name, "/") || strings.Contains(name, ":") {
		return ""
	}
	p := path.Clean(name)
	if p == "." || p == ".." || strings.HasPrefix(p, "../") {
		return ""
	}
	return p
}

// readPackage checks a .gaddin zip and returns its manifest and files (path -> content).
// A package may keep its files in one top-level folder; that folder is stripped.
func readPackage(data []byte) (*Manifest, map[string][]byte, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, nil, errors.New("not a valid .gaddin file (it must be a zip archive)")
	}
	if len(zr.File) > maxAddinFiles {
		return nil, nil, fmt.Errorf("the package has more than %d files", maxAddinFiles)
	}
	files := map[string][]byte{}
	var total int64
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		p := cleanZipPath(f.Name)
		if p == "" {
			return nil, nil, fmt.Errorf("unsafe file name in package: %q", f.Name)
		}
		if strings.HasPrefix(p, "__MACOSX/") || path.Base(p) == ".DS_Store" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, nil, err
		}
		b, err := io.ReadAll(io.LimitReader(rc, maxAddinUnpacked-total+1))
		rc.Close()
		if err != nil {
			return nil, nil, err
		}
		total += int64(len(b))
		if total > maxAddinUnpacked {
			return nil, nil, errors.New("the package is too large when unpacked (limit 100 MB)")
		}
		files[p] = b
	}
	// Strip a single top-level folder if addin.json is inside it.
	if _, ok := files[addinManifestName]; !ok {
		prefix := ""
		for p := range files {
			if path.Base(p) == addinManifestName && strings.Count(p, "/") == 1 {
				prefix = path.Dir(p) + "/"
			}
		}
		if prefix == "" {
			for p := range files {
				if path.Base(p) == jmpDefName && strings.Count(p, "/") <= 1 {
					return nil, files, errJMPAddin
				}
			}
			return nil, nil, errors.New("the package has no addin.json")
		}
		stripped := map[string][]byte{}
		for p, b := range files {
			if strings.HasPrefix(p, prefix) {
				stripped[strings.TrimPrefix(p, prefix)] = b
			}
		}
		files = stripped
	}
	if _, ok := files[addinManifestName]; !ok {
		if _, ok := files[jmpDefName]; ok {
			return nil, files, errJMPAddin
		}
	}
	var m Manifest
	if err := json.Unmarshal(files[addinManifestName], &m); err != nil {
		return nil, nil, fmt.Errorf("addin.json is not valid JSON: %v", err)
	}
	m.Main = cleanZipPath(m.Main)
	if err := m.validate(); err != nil {
		return nil, nil, err
	}
	if _, ok := files[m.Main]; !ok {
		return nil, nil, fmt.Errorf("addin.json names %q as main, but the package has no such file", m.Main)
	}
	return &m, files, nil
}

// installPackage replaces any installed copy of the same add-in id.
func installPackage(data []byte) (*Manifest, error) {
	m, files, err := readPackage(data)
	if err != nil {
		if errors.Is(err, errJMPAddin) {
			return nil, &JMPAddinError{Info: inspectJMPAddin(files)}
		}
		return nil, err
	}
	if err := os.MkdirAll(addinsDir(), 0o755); err != nil {
		return nil, err
	}
	tmp, err := os.MkdirTemp(addinsDir(), ".install-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmp)
	for p, b := range files {
		dst := filepath.Join(tmp, filepath.FromSlash(p))
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return nil, err
		}
		if err := os.WriteFile(dst, b, 0o644); err != nil {
			return nil, err
		}
	}
	m.Enabled = true
	state, _ := json.Marshal(map[string]bool{"enabled": true})
	os.WriteFile(filepath.Join(tmp, ".state.json"), state, 0o644)
	final := filepath.Join(addinsDir(), m.ID)
	os.RemoveAll(final)
	if err := os.Rename(tmp, final); err != nil {
		return nil, err
	}
	return m, nil
}

func loadManifest(id string) (*Manifest, error) {
	dir := filepath.Join(addinsDir(), id)
	b, err := os.ReadFile(filepath.Join(dir, addinManifestName))
	if err != nil {
		return nil, err
	}
	var m Manifest
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	m.Main = cleanZipPath(m.Main)
	if m.ID != id || m.validate() != nil {
		return nil, errors.New("invalid add-in")
	}
	m.Enabled = true
	if sb, err := os.ReadFile(filepath.Join(dir, ".state.json")); err == nil {
		var s struct{ Enabled bool }
		if json.Unmarshal(sb, &s) == nil {
			m.Enabled = s.Enabled
		}
	}
	return &m, nil
}

func listAddins() []*Manifest {
	out := []*Manifest{}
	entries, _ := os.ReadDir(addinsDir())
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		if m, err := loadManifest(e.Name()); err == nil {
			out = append(out, m)
		}
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

// trustedWrite blocks other web pages on this computer from changing add-ins: browsers only send
// the X-Gothysis header from our own page (a cross-site page would need CORS, which we never allow).
func trustedWrite(r *http.Request) bool {
	if r.Header.Get("X-Gothysis") != "1" {
		return false
	}
	if o := r.Header.Get("Origin"); o != "" && o != fmt.Sprintf("http://127.0.0.1:%d", port) && o != "http://"+r.Host {
		return false
	}
	return true
}

// /api/addins            GET: list    POST: install (body = .gaddin bytes)
// /api/addins/<id>       DELETE: remove    PATCH {"enabled": bool}: enable or disable
func addinsAPI(w http.ResponseWriter, r *http.Request) {
	id := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/addins"), "/")
	if r.Method != http.MethodGet && !trustedWrite(r) {
		writeJSON(w, 403, map[string]string{"error": "forbidden"})
		return
	}
	switch {
	case id == "" && r.Method == http.MethodGet:
		writeJSON(w, 200, map[string]any{"apiVersion": addinAPIVersion, "dir": addinsDir(), "addins": listAddins()})
	case id == "" && r.Method == http.MethodPost:
		data, err := io.ReadAll(io.LimitReader(r.Body, maxAddinUpload+1))
		if err != nil {
			writeJSON(w, 400, map[string]string{"error": err.Error()})
			return
		}
		if len(data) > maxAddinUpload {
			writeJSON(w, 400, map[string]string{"error": "the .gaddin file is larger than 25 MB"})
			return
		}
		m, err := installPackage(data)
		var jerr *JMPAddinError
		if errors.As(err, &jerr) {
			writeJSON(w, 422, map[string]any{"error": err.Error(), "jmpAddin": jerr.Info})
			return
		}
		if err != nil {
			writeJSON(w, 400, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, m)
	case addinID.MatchString(id) && r.Method == http.MethodDelete:
		if _, err := loadManifest(id); err != nil {
			writeJSON(w, 404, map[string]string{"error": "no such add-in"})
			return
		}
		if err := os.RemoveAll(filepath.Join(addinsDir(), id)); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]string{"removed": id})
	case addinID.MatchString(id) && r.Method == http.MethodPatch:
		var q struct{ Enabled bool }
		if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&q); err != nil {
			writeJSON(w, 400, map[string]string{"error": err.Error()})
			return
		}
		m, err := loadManifest(id)
		if err != nil {
			writeJSON(w, 404, map[string]string{"error": "no such add-in"})
			return
		}
		b, _ := json.Marshal(map[string]bool{"enabled": q.Enabled})
		os.WriteFile(filepath.Join(addinsDir(), id, ".state.json"), b, 0o644)
		m.Enabled = q.Enabled
		writeJSON(w, 200, m)
	default:
		writeJSON(w, 405, map[string]string{"error": "method not allowed"})
	}
}

// /addins/<id>/<file> serves an installed add-in's files to the page.
func addinFiles(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/addins/")
	id, file, _ := strings.Cut(rest, "/")
	file = cleanZipPath(file)
	if !addinID.MatchString(id) || file == "" || strings.HasPrefix(path.Base(file), ".") {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeFile(w, r, filepath.Join(addinsDir(), id, filepath.FromSlash(file)))
}

// ---------- JMP add-ins (.jmpaddin) ----------
// A .jmpaddin is a zip with addin.def (id="…", name="…"), usually addin.jmpcust (menu XML) and
// JSL scripts. Gothysis cannot run JSL, so it reports what is inside to help convert it.

const jmpDefName = "addin.def"

var errJMPAddin = errors.New("jmp add-in")

type JMPAddinError struct{ Info *JMPAddinInfo }

func (e *JMPAddinError) Error() string {
	return "this is a JMP add-in (.jmpaddin). Its scripts are written in JMP's scripting language (JSL), " +
		"which only JMP can run, so it must be converted to a Gothysis add-in (.gaddin) first"
}

type JMPMenuItem struct {
	Caption string `json:"caption"`
	Action  string `json:"action"`
}

type JMPFile struct {
	Path  string `json:"path"`
	Bytes int    `json:"bytes"`
	Lines int    `json:"lines,omitempty"`
}

type JMPAddinInfo struct {
	ID         string            `json:"id"`
	Name       string            `json:"name"`
	Settings   map[string]string `json:"settings"`
	Menu       []JMPMenuItem     `json:"menu"`
	Scripts    []JMPFile         `json:"scripts"`
	OtherFiles []JMPFile         `json:"otherFiles"`
}

var (
	defLine      = regexp.MustCompile(`^\s*([A-Za-z_]+)\s*=\s*"?(.*?)"?\s*$`)
	jmpCommand   = regexp.MustCompile(`(?s)<jm:command\b.*?</jm:command>`)
	jmpCaption   = regexp.MustCompile(`(?s)<jm:caption>(.*?)</jm:caption>`)
	jmpAction    = regexp.MustCompile(`(?s)<jm:action\b[^>]*>(.*?)</jm:action>`)
	xmlEntityRep = strings.NewReplacer("&amp;", "&", "&lt;", "<", "&gt;", ">", "&quot;", `"`, "&apos;", "'")
)

func decodeText(b []byte) string {
	// addin.def and .jsl files are often UTF-16 with a byte-order mark when saved by JMP on Windows.
	if len(b) >= 2 && ((b[0] == 0xFF && b[1] == 0xFE) || (b[0] == 0xFE && b[1] == 0xFF)) {
		le := b[0] == 0xFF
		r := make([]rune, 0, len(b)/2)
		for i := 2; i+1 < len(b); i += 2 {
			if le {
				r = append(r, rune(b[i])|rune(b[i+1])<<8)
			} else {
				r = append(r, rune(b[i])<<8|rune(b[i+1]))
			}
		}
		return string(r)
	}
	return strings.TrimPrefix(string(b), "\uFEFF")
}

func inspectJMPAddin(files map[string][]byte) *JMPAddinInfo {
	info := &JMPAddinInfo{Settings: map[string]string{}, Menu: []JMPMenuItem{}, Scripts: []JMPFile{}, OtherFiles: []JMPFile{}}
	prefix := ""
	for p := range files {
		if path.Base(p) == jmpDefName && strings.Count(p, "/") <= 1 {
			if d := path.Dir(p); d != "." {
				prefix = d + "/"
			}
		}
	}
	for _, line := range strings.Split(decodeText(files[prefix+jmpDefName]), "\n") {
		if m := defLine.FindStringSubmatch(strings.TrimSpace(line)); m != nil {
			k := strings.ToLower(m[1])
			info.Settings[k] = m[2]
			switch k {
			case "id":
				info.ID = m[2]
			case "name":
				info.Name = m[2]
			}
		}
	}
	if cust, ok := files[prefix+"addin.jmpcust"]; ok {
		for _, cmd := range jmpCommand.FindAllString(decodeText(cust), -1) {
			it := JMPMenuItem{}
			if m := jmpCaption.FindStringSubmatch(cmd); m != nil {
				it.Caption = strings.TrimSpace(xmlEntityRep.Replace(m[1]))
			}
			if m := jmpAction.FindStringSubmatch(cmd); m != nil {
				it.Action = strings.TrimSpace(xmlEntityRep.Replace(m[1]))
				if len(it.Action) > 300 {
					it.Action = it.Action[:300] + "…"
				}
			}
			if it.Caption != "" || it.Action != "" {
				info.Menu = append(info.Menu, it)
			}
		}
	}
	names := make([]string, 0, len(files))
	for p := range files {
		names = append(names, p)
	}
	sort.Strings(names)
	for _, p := range names {
		rel := strings.TrimPrefix(p, prefix)
		f := JMPFile{Path: rel, Bytes: len(files[p])}
		if strings.EqualFold(path.Ext(p), ".jsl") {
			f.Lines = strings.Count(decodeText(files[p]), "\n") + 1
			info.Scripts = append(info.Scripts, f)
		} else if rel != jmpDefName && rel != "addin.jmpcust" {
			info.OtherFiles = append(info.OtherFiles, f)
		}
	}
	return info
}
