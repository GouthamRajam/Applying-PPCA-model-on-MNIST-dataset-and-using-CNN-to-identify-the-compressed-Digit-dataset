package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestWatcherReportsOnlyFinishedNewFiles(t *testing.T) {
	d := t.TempDir()
	os.WriteFile(filepath.Join(d, "old.csv"), []byte("a"), 0o644)
	var got []string
	w := NewFolderWatcher(d, time.Hour)
	w.OnFile = func(n, _ string) { got = append(got, n) }
	w.Start()
	defer w.Stop()
	os.WriteFile(filepath.Join(d, "new.csv"), []byte("1,2"), 0o644)
	os.WriteFile(filepath.Join(d, "skip.png"), []byte("x"), 0o644)
	w.Poll() // first sighting: maybe still being written
	if len(got) != 0 {
		t.Fatalf("reported too early: %v", got)
	}
	w.Poll() // unchanged: finished
	if len(got) != 1 || got[0] != "new.csv" {
		t.Fatalf("got %v, want [new.csv]", got)
	}
	os.WriteFile(filepath.Join(d, "mine.csv"), []byte("x"), 0o644)
	w.MarkSeen("mine.csv")
	w.Poll()
	w.Poll()
	if len(got) != 1 {
		t.Fatalf("own export reported: %v", got)
	}
}

func TestFoupLink(t *testing.T) {
	if l := FoupLink("10.255.255."); l["up"] != false {
		t.Fatalf("unexpected link: %v", l)
	}
	if want := os.Getenv("SENSON_EXPECT_LINK"); want != "" {
		// SENSON_EXPECT_LINK=<an address this machine has>: the check must find it by its prefix.
		prefix := want[:strings.LastIndex(want, ".")+1]
		if l := FoupLink(prefix); l["address"] != want {
			t.Fatalf("got %v, want %s", l, want)
		}
	}
}
