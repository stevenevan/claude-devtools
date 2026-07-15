package maintenance

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func TestScanLogsAndDaemon(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "logs", "devtools.2026-06-22.jsonl"), "a")
	writeFile(t, filepath.Join(root, "daemon.log"), "d")
	writeFile(t, filepath.Join(root, "daemon.log.1"), "d1")

	logs, err := ScanCategory(context.Background(), CategorySpec{ID: "logs", Root: root, Now: time.Now()})
	if err != nil || len(logs) != 1 || logs[0].Meta["owner"] != "app" {
		t.Fatalf("logs matcher: %v %+v", err, logs)
	}
	daemon, err := ScanCategory(context.Background(), CategorySpec{ID: "logs-daemon", Root: root, Now: time.Now()})
	if err != nil || len(daemon) != 2 {
		t.Fatalf("logs-daemon should find daemon.log + .1, got %d: %v", len(daemon), err)
	}
	for _, c := range daemon {
		if c.Meta["owner"] != "daemon" {
			t.Errorf("daemon owner tag wrong: %v", c.Meta)
		}
	}
}

func TestScanCaches(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "cache", "changelog.md"), "log")
	writeFile(t, filepath.Join(root, "stats-cache.json"), "{}")
	writeFile(t, filepath.Join(root, "paste-cache", "blob1"), "pasted secret")
	writeFile(t, filepath.Join(root, "some-unknown-cache.json"), "x") // must NOT be a candidate

	cands, err := ScanCategory(context.Background(), CategorySpec{ID: "caches", Root: root, Now: time.Now()})
	if err != nil {
		t.Fatal(err)
	}

	names := map[string]Candidate{}
	for _, c := range cands {
		names[filepath.Base(c.Path)] = c
		if filepath.Base(c.Path) == "some-unknown-cache.json" {
			t.Error("unknown cache-looking file must NOT be a candidate (allowlist only)")
		}
	}
	if _, ok := names["changelog.md"]; !ok {
		t.Error("changelog.md should be a candidate")
	}
	if names["changelog.md"].Meta["regeneratedBy"] == "" {
		t.Error("cache candidate must carry a regeneratedBy note")
	}
	if names["blob1"].Meta["sensitive"] != "true" {
		t.Error("paste-cache blob must be flagged sensitive")
	}
}
