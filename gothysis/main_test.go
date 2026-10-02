package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestServesEmbeddedApp(t *testing.T) {
	srv := httptest.NewServer(handler())
	defer srv.Close()
	for path, want := range map[string]string{"/": "<title>Gothysis</title>", "/stats.js": "function ppca(", "/sample.js": "Iris.csv", "/api/version": `"Gothysis"`} {
		resp, err := http.Get(srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != 200 || !strings.Contains(string(b), want) {
			t.Errorf("%s: status %d, missing %q", path, resp.StatusCode, want)
		}
	}
}
