package maintenance

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func TestScanPlans(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "plans")
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.Local)

	// A stale plan + its variant sibling (grouped), plus a fresh standalone plan.
	writeAged(t, filepath.Join(dir, "feature.md"), "# plan", now.AddDate(0, 0, -120))
	writeAged(t, filepath.Join(dir, "feature.agent.md"), "# variant", now.AddDate(0, 0, -120))
	writeAged(t, filepath.Join(dir, "recent.md"), "# recent", now.AddDate(0, 0, -3))

	spec := CategorySpec{ID: "plans", Root: root, Now: now, Cutoff: now.AddDate(0, 0, -60)}
	cands, err := ScanCategory(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}
	if len(cands) != 3 {
		t.Fatalf("all plans listed as candidates, want 3 got %d", len(cands))
	}

	byName := map[string]Candidate{}
	for _, c := range cands {
		byName[c.Meta["name"]] = c
	}

	// Variant siblings share a group; the standalone plan is ungrouped.
	if byName["feature.md"].Group != "feature" || byName["feature.agent.md"].Group != "feature" {
		t.Errorf("variant siblings should group under 'feature': %v / %v",
			byName["feature.md"].Group, byName["feature.agent.md"].Group)
	}
	if byName["recent.md"].Group != "" {
		t.Errorf("standalone plan should be ungrouped, got %q", byName["recent.md"].Group)
	}

	// Staleness is a badge, not a filter: old plans flagged, fresh not.
	if byName["feature.md"].Meta["stale"] != "true" {
		t.Error("120-day-old plan should be flagged stale")
	}
	if byName["recent.md"].Meta["stale"] == "true" {
		t.Error("3-day-old plan must not be flagged stale")
	}
}
