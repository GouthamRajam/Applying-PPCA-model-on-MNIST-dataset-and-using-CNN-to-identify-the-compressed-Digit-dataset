package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func makeZip(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, body := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		w.Write([]byte(body))
	}
	zw.Close()
	return buf.Bytes()
}

const goodManifest = `{"id":"com.example.hello","name":"Hello","version":"1.0","main":"main.js","apiVersion":1}`

func do(t *testing.T, srv *httptest.Server, method, path string, body []byte, trusted bool) (int, string) {
	t.Helper()
	req, _ := http.NewRequest(method, srv.URL+path, bytes.NewReader(body))
	if trusted {
		req.Header.Set("X-Gothysis", "1")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b)
}

func TestAddinLifecycle(t *testing.T) {
	t.Setenv("GOTHYSIS_USERDATA", t.TempDir())
	srv := httptest.NewServer(handler())
	defer srv.Close()

	// Files inside one top-level folder, as Windows "Send to > Compressed folder" makes them.
	pkg := makeZip(t, map[string]string{"hello/addin.json": goodManifest, "hello/main.js": "console.log('hi')", "hello/lib/util.js": "x"})
	if code, body := do(t, srv, "POST", "/api/addins", pkg, false); code != 403 {
		t.Fatalf("install without X-Gothysis header: got %d %s, want 403", code, body)
	}
	if code, body := do(t, srv, "POST", "/api/addins", pkg, true); code != 200 || !strings.Contains(body, `"enabled":true`) {
		t.Fatalf("install: %d %s", code, body)
	}
	code, body := do(t, srv, "GET", "/api/addins", nil, false)
	var list struct{ Addins []Manifest }
	json.Unmarshal([]byte(body), &list)
	if code != 200 || len(list.Addins) != 1 || list.Addins[0].ID != "com.example.hello" {
		t.Fatalf("list: %d %s", code, body)
	}
	if code, body := do(t, srv, "GET", "/addins/com.example.hello/lib/util.js", nil, false); code != 200 || body != "x" {
		t.Fatalf("serve file: %d %q", code, body)
	}
	if code, _ := do(t, srv, "GET", "/addins/com.example.hello/.state.json", nil, false); code != 404 {
		t.Fatalf("hidden state file must not be served, got %d", code)
	}
	if code, body := do(t, srv, "PATCH", "/api/addins/com.example.hello", []byte(`{"enabled":false}`), true); code != 200 || !strings.Contains(body, `"enabled":false`) {
		t.Fatalf("disable: %d %s", code, body)
	}
	if m, _ := loadManifest("com.example.hello"); m == nil || m.Enabled {
		t.Fatal("disabled state was not kept")
	}
	// Reinstalling replaces the old copy and enables it again.
	if code, _ := do(t, srv, "POST", "/api/addins", makeZip(t, map[string]string{"addin.json": goodManifest, "main.js": "v2"}), true); code != 200 {
		t.Fatal("reinstall failed")
	}
	if code, body := do(t, srv, "GET", "/addins/com.example.hello/main.js", nil, false); code != 200 || body != "v2" {
		t.Fatalf("reinstall did not replace files: %q", body)
	}
	if code, _ := do(t, srv, "GET", "/addins/com.example.hello/lib/util.js", nil, false); code != 404 {
		t.Fatal("files from the old version were left behind")
	}
	if code, body := do(t, srv, "DELETE", "/api/addins/com.example.hello", nil, true); code != 200 {
		t.Fatalf("remove: %d %s", code, body)
	}
	if len(listAddins()) != 0 {
		t.Fatal("add-in still listed after removal")
	}
}

func TestAddinRejectsBadPackages(t *testing.T) {
	t.Setenv("GOTHYSIS_USERDATA", t.TempDir())
	cases := map[string][]byte{
		"not a zip":        []byte("hello"),
		"no manifest":      makeZip(t, map[string]string{"main.js": "x"}),
		"path traversal":   makeZip(t, map[string]string{"addin.json": goodManifest, "main.js": "x", "../../evil.js": "x"}),
		"absolute path":    makeZip(t, map[string]string{"addin.json": goodManifest, "main.js": "x", "/etc/evil": "x"}),
		"bad id":           makeZip(t, map[string]string{"addin.json": `{"id":"../x","name":"a","version":"1","main":"main.js","apiVersion":1}`, "main.js": "x"}),
		"missing main":     makeZip(t, map[string]string{"addin.json": goodManifest}),
		"future api":       makeZip(t, map[string]string{"addin.json": `{"id":"abc","name":"a","version":"1","main":"main.js","apiVersion":9}`, "main.js": "x"}),
		"main not js":      makeZip(t, map[string]string{"addin.json": `{"id":"abc","name":"a","version":"1","main":"main.exe","apiVersion":1}`, "main.exe": "x"}),
		"invalid manifest": makeZip(t, map[string]string{"addin.json": `{`, "main.js": "x"}),
	}
	for name, data := range cases {
		if _, err := installPackage(data); err == nil {
			t.Errorf("%s: package was accepted", name)
		}
	}
	if len(listAddins()) != 0 {
		t.Fatal("a rejected package was installed")
	}
}

func TestAddinRejectsOtherOrigins(t *testing.T) {
	t.Setenv("GOTHYSIS_USERDATA", t.TempDir())
	srv := httptest.NewServer(handler())
	defer srv.Close()
	req, _ := http.NewRequest("POST", srv.URL+"/api/addins", bytes.NewReader(makeZip(t, map[string]string{"addin.json": goodManifest, "main.js": "x"})))
	req.Header.Set("X-Gothysis", "1")
	req.Header.Set("Origin", "https://evil.example")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatalf("got %d, want 403", resp.StatusCode)
	}
}

func utf16le(s string) string {
	b := []byte{0xFF, 0xFE}
	for _, r := range s {
		b = append(b, byte(r), byte(r>>8))
	}
	return string(b)
}

func TestJMPAddinIsInspectedNotInstalled(t *testing.T) {
	t.Setenv("GOTHYSIS_USERDATA", t.TempDir())
	srv := httptest.NewServer(handler())
	defer srv.Close()
	cust := `<?xml version="1.0" encoding="utf-8"?>
<jm:menu_and_toolbar_customizations xmlns:jm="http://www.jmp.com/ns/menu" version="3">
  <jm:insert_in_main_menu><jm:insert_in_menu><jm:name>ADD-INS</jm:name><jm:insert_after><jm:name></jm:name>
    <jm:command>
      <jm:name>com.mycompany.wijit</jm:name>
      <jm:caption>Wijit &amp; Report</jm:caption>
      <jm:action type="path">$ADDIN_HOME(com.mycompany.wijit)\wijit.jsl</jm:action>
    </jm:command>
  </jm:insert_after></jm:insert_in_menu></jm:insert_in_main_menu>
</jm:menu_and_toolbar_customizations>`
	pkg := makeZip(t, map[string]string{
		"Wijit/addin.def":     utf16le("id=\"com.mycompany.wijit\"\r\nname=\"Wijit\"\r\nminJMPVersion=\"17\"\r\n"),
		"Wijit/addin.jmpcust": cust,
		"Wijit/wijit.jsl":     "dt = Current Data Table();\nDistribution( Y( :height ) );\n",
		"Wijit/icon.png":      "png",
	})
	code, body := do(t, srv, "POST", "/api/addins", pkg, true)
	if code != 422 {
		t.Fatalf("got %d %s, want 422", code, body)
	}
	var resp struct {
		Error    string
		JMPAddin JMPAddinInfo `json:"jmpAddin"`
	}
	if err := json.Unmarshal([]byte(body), &resp); err != nil {
		t.Fatal(err)
	}
	j := resp.JMPAddin
	if j.ID != "com.mycompany.wijit" || j.Name != "Wijit" || j.Settings["minjmpversion"] != "17" {
		t.Errorf("addin.def not read: %+v", j)
	}
	if len(j.Menu) != 1 || j.Menu[0].Caption != "Wijit & Report" || !strings.HasSuffix(j.Menu[0].Action, `\wijit.jsl`) {
		t.Errorf("menu not read: %+v", j.Menu)
	}
	if len(j.Scripts) != 1 || j.Scripts[0].Path != "wijit.jsl" || j.Scripts[0].Lines != 3 {
		t.Errorf("scripts not listed: %+v", j.Scripts)
	}
	if len(j.OtherFiles) != 1 || j.OtherFiles[0].Path != "icon.png" {
		t.Errorf("other files: %+v", j.OtherFiles)
	}
	if !strings.Contains(resp.Error, "JSL") {
		t.Errorf("error should explain JSL: %s", resp.Error)
	}
	if len(listAddins()) != 0 {
		t.Fatal("a JMP add-in must not be installed")
	}
}
