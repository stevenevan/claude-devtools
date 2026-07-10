package maintenance

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func TestScanProjects(t *testing.T) {
	root := t.TempDir()
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.Local)
	// Encoded project dir "-Users-me-proj" → decoded "/Users/me/proj".
	projDir := filepath.Join(root, "projects", "-Users-me-proj")

	old := writeAged(t, filepath.Join(projDir, "ses-old.jsonl"), "{}", now.AddDate(0, 0, -120))
	writeAged(t, filepath.Join(projDir, "ses-pinned.jsonl"), "{}", now.AddDate(0, 0, -120))
	writeAged(t, filepath.Join(projDir, "ses-fresh.jsonl"), "{}", now.AddDate(0, 0, -2))

	spec := CategorySpec{
		ID: "projects", Root: root, Now: now, Cutoff: now.AddDate(0, 0, -90),
		Pinned: []string{"ses-pinned"},
	}
	cands, err := ScanCategory(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}
	if len(cands) != 2 {
		t.Fatalf("want 2 old candidates (fresh excluded), got %d: %+v", len(cands), cands)
	}

	byName := map[string]Candidate{}
	for _, c := range cands {
		byName[c.Meta["sessionId"]] = c
	}
	if _, ok := byName["ses-fresh"]; ok {
		t.Error("today-ish/fresh session must be excluded")
	}
	if byName["ses-old"].Path != old {
		t.Errorf("old session path mismatch: %s", byName["ses-old"].Path)
	}
	if byName["ses-old"].Group != "/Users/me/proj" {
		t.Errorf("group should be decoded path, got %q", byName["ses-old"].Group)
	}
	if byName["ses-pinned"].Meta["pinned"] != "true" {
		t.Error("pinned session should be flagged")
	}
	if byName["ses-old"].Meta["pinned"] == "true" {
		t.Error("non-pinned session must not be flagged pinned")
	}
}
