package maintenance

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// buildPluginsFixture lays out a realistic <root>/plugins tree:
//   cache/<marketplace>/<plugin>/<version>/  (two plugins, one enabled)
//   marketplaces/<name>/
//   repos/  (empty → anomaly)
func buildPluginsFixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "plugins", "cache", "acme", "linter", "1.0.0", "x.js"), "aaaa")
	writeFile(t, filepath.Join(root, "plugins", "cache", "acme", "formatter", "2.0.0", "y.js"), "bb")
	writeFile(t, filepath.Join(root, "plugins", "marketplaces", "acme", "index.json"), "{}")
	// repos/ exists but empty.
	if err := os.MkdirAll(filepath.Join(root, "plugins", "repos"), 0o755); err != nil {
		t.Fatal(err)
	}
	// config files that must NOT become candidates.
	writeFile(t, filepath.Join(root, "plugins", "installed_plugins.json"), "{}")
	writeFile(t, filepath.Join(root, "plugins", "config.json"), "{}")
	return root
}

func TestScanPlugins(t *testing.T) {
	root := buildPluginsFixture(t)
	spec := CategorySpec{
		ID:      "plugins",
		Root:    root,
		Now:     time.Now(),
		Enabled: []string{"linter@acme"}, // linter enabled, formatter not
	}

	cands, err := ScanCategory(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}

	byPlugin := map[string]Candidate{}
	groups := map[string]int{}
	for _, c := range cands {
		groups[c.Group]++
		if c.Group == "cache" {
			byPlugin[c.Meta["plugin"]] = c
		}
	}

	if groups["cache"] != 2 {
		t.Fatalf("want 2 cache candidates, got %d (%v)", groups["cache"], groups)
	}
	if groups["marketplaces"] != 1 {
		t.Errorf("want 1 marketplace candidate, got %d", groups["marketplaces"])
	}
	// repos/ empty → no repos candidates, and cache candidates flagged anomalous.
	if groups["repos"] != 0 {
		t.Errorf("empty repos/ must yield 0 candidates, got %d", groups["repos"])
	}

	// Config files (installed_plugins.json, config.json) must never be candidates.
	for _, c := range cands {
		base := filepath.Base(c.Path)
		if base == "installed_plugins.json" || base == "config.json" {
			t.Errorf("config file leaked as candidate: %s", c.Path)
		}
	}

	// Enabled cross-reference: linter enabled (safe-but-redownload), formatter not.
	if byPlugin["linter"].Meta["enabled"] != "true" {
		t.Errorf("linter should be enabled: %v", byPlugin["linter"].Meta)
	}
	if byPlugin["formatter"].Meta["enabled"] != "false" {
		t.Errorf("formatter should be disabled: %v", byPlugin["formatter"].Meta)
	}

	// Anomaly flag on cache candidates (repos empty while cache non-empty).
	if byPlugin["linter"].Meta["layoutAnomaly"] != "repos-empty" {
		t.Errorf("expected repos-empty anomaly flag, got %v", byPlugin["linter"].Meta)
	}

	// Byte accounting: linter cache = 4 bytes.
	if byPlugin["linter"].Bytes != 4 {
		t.Errorf("linter bytes=%d want 4", byPlugin["linter"].Bytes)
	}
}

// TestScanPluginsEnabledByBareName covers the enabled[name] fallback: a plugin
// enabled by bare name (no @marketplace) must still be recognized.
func TestScanPluginsEnabledByBareName(t *testing.T) {
	root := buildPluginsFixture(t)
	spec := CategorySpec{ID: "plugins", Root: root, Now: time.Now(), Enabled: []string{"formatter"}}
	cands, err := ScanCategory(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range cands {
		if c.Group == "cache" && c.Meta["plugin"] == "formatter" && c.Meta["enabled"] != "true" {
			t.Errorf("formatter enabled by bare name should be true, got %v", c.Meta)
		}
	}
}
