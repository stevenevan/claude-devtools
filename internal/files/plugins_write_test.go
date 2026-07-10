package files

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// pluginsSettingsSeed carries an unrelated top-level key and an unrelated
// enabledPlugins entry, to prove SetPluginEnabled/DedupePlugin never touch
// anything outside the key(s) they're asked to change.
const pluginsSettingsSeed = `{
	"theme": "dark",
	"enabledPlugins": {
		"some-other-plugin@some-marketplace": true
	}
}`

func TestPluginSetEnabledRoundTripPreservesUnrelatedKeys(t *testing.T) {
	dir, settingsFile, _, _ := settingsPaths(t)
	writeSettingsFile(t, dir, settingsFile, pluginsSettingsSeed)

	key := "chrome-devtools-mcp@chrome-devtools-plugins"

	if err := SetPluginEnabled(key, true); err != nil {
		t.Fatalf("SetPluginEnabled(enable): %v", err)
	}
	afterEnable := readJSONMap(t, settingsFile)
	enabledAfterEnable, ok := afterEnable["enabledPlugins"].(map[string]any)
	if !ok || enabledAfterEnable[key] != true {
		t.Fatalf("key not enabled: %v", afterEnable["enabledPlugins"])
	}
	if afterEnable["theme"] != "dark" {
		t.Errorf("theme not preserved: %v", afterEnable["theme"])
	}
	if enabledAfterEnable["some-other-plugin@some-marketplace"] != true {
		t.Errorf("unrelated enabledPlugins entry lost: %v", enabledAfterEnable)
	}

	if err := SetPluginEnabled(key, false); err != nil {
		t.Fatalf("SetPluginEnabled(disable): %v", err)
	}
	afterDisable := readJSONMap(t, settingsFile)
	enabledAfterDisable, ok := afterDisable["enabledPlugins"].(map[string]any)
	if !ok {
		t.Fatalf("enabledPlugins missing after disable: %v", afterDisable)
	}
	if _, present := enabledAfterDisable[key]; present {
		t.Errorf("key still present after disable: %v", enabledAfterDisable)
	}
	if afterDisable["theme"] != "dark" {
		t.Errorf("theme not preserved after disable: %v", afterDisable["theme"])
	}

	wantUnrelated := map[string]any{"some-other-plugin@some-marketplace": true}
	if !reflect.DeepEqual(enabledAfterDisable, wantUnrelated) {
		t.Errorf("enabledPlugins after disable = %v, want %v", enabledAfterDisable, wantUnrelated)
	}
}

func TestPluginSetEnabledDisableRemovesExactlyOneEntry(t *testing.T) {
	dir, settingsFile, _, _ := settingsPaths(t)
	seed := `{
		"enabledPlugins": {
			"plugin-a@marketplace-1": true,
			"plugin-b@marketplace-1": true
		}
	}`
	writeSettingsFile(t, dir, settingsFile, seed)

	if err := SetPluginEnabled("plugin-a@marketplace-1", false); err != nil {
		t.Fatalf("SetPluginEnabled: %v", err)
	}

	settings := readJSONMap(t, settingsFile)
	enabled := settings["enabledPlugins"].(map[string]any)
	want := map[string]any{"plugin-b@marketplace-1": true}
	if !reflect.DeepEqual(enabled, want) {
		t.Errorf("enabledPlugins = %v, want %v", enabled, want)
	}
}

func TestPluginDedupeKeepsOnlyKeepKey(t *testing.T) {
	dir, settingsFile, _, _ := settingsPaths(t)
	seed := `{
		"enabledPlugins": {
			"chrome-devtools-mcp@keep": true,
			"chrome-devtools-mcp@other": true,
			"unrelated-plugin@some-marketplace": true
		}
	}`
	writeSettingsFile(t, dir, settingsFile, seed)

	if err := DedupePlugin("chrome-devtools-mcp", "chrome-devtools-mcp@keep"); err != nil {
		t.Fatalf("DedupePlugin: %v", err)
	}

	settings := readJSONMap(t, settingsFile)
	enabled := settings["enabledPlugins"].(map[string]any)
	want := map[string]any{
		"chrome-devtools-mcp@keep":          true,
		"unrelated-plugin@some-marketplace": true,
	}
	if !reflect.DeepEqual(enabled, want) {
		t.Errorf("enabledPlugins = %v, want %v", enabled, want)
	}
}

func TestPluginDedupeRemovesBareNameKey(t *testing.T) {
	dir, settingsFile, _, _ := settingsPaths(t)
	seed := `{
		"enabledPlugins": {
			"chrome-devtools-mcp": true,
			"chrome-devtools-mcp@keep": true,
			"unrelated-plugin@some-marketplace": true
		}
	}`
	writeSettingsFile(t, dir, settingsFile, seed)

	if err := DedupePlugin("chrome-devtools-mcp", "chrome-devtools-mcp@keep"); err != nil {
		t.Fatalf("DedupePlugin: %v", err)
	}

	settings := readJSONMap(t, settingsFile)
	enabled := settings["enabledPlugins"].(map[string]any)
	want := map[string]any{
		"chrome-devtools-mcp@keep":          true,
		"unrelated-plugin@some-marketplace": true,
	}
	if !reflect.DeepEqual(enabled, want) {
		t.Errorf("enabledPlugins = %v, want %v", enabled, want)
	}
}

func TestPluginDetectDuplicatesFlagsMultiMarketplace(t *testing.T) {
	plugins := []Plugin{
		{ID: "chrome-devtools-mcp@chrome-devtools-plugins", Name: "chrome-devtools-mcp", Marketplace: "chrome-devtools-plugins", Enabled: true},
		{ID: "chrome-devtools-mcp@claude-plugins-official", Name: "chrome-devtools-mcp", Marketplace: "claude-plugins-official", Enabled: true},
		{ID: "single-marketplace-plugin@some-marketplace", Name: "single-marketplace-plugin", Marketplace: "some-marketplace", Enabled: true},
		{ID: "not-enabled-elsewhere@marketplace-a", Name: "not-enabled-elsewhere", Marketplace: "marketplace-a", Enabled: true},
		{ID: "not-enabled-elsewhere@marketplace-b", Name: "not-enabled-elsewhere", Marketplace: "marketplace-b", Enabled: false},
	}

	got := DetectPluginDuplicates(plugins)

	if len(got) != 1 {
		t.Fatalf("len(groups) = %d, want 1: %+v", len(got), got)
	}
	if got[0].Name != "chrome-devtools-mcp" {
		t.Errorf("group name = %q, want chrome-devtools-mcp", got[0].Name)
	}
	if len(got[0].Entries) != 2 {
		t.Fatalf("len(entries) = %d, want 2: %+v", len(got[0].Entries), got[0].Entries)
	}
	if got[0].Entries[0].Marketplace != "chrome-devtools-plugins" || got[0].Entries[1].Marketplace != "claude-plugins-official" {
		t.Errorf("entries not sorted by marketplace: %+v", got[0].Entries)
	}
}

func TestPluginInstalledPluginsJSONByteIdenticalAcrossToggleAndDedupe(t *testing.T) {
	dir, settingsFile, _, _ := settingsPaths(t)
	seed := `{
		"enabledPlugins": {
			"chrome-devtools-mcp@chrome-devtools-plugins": true,
			"chrome-devtools-mcp@claude-plugins-official": true
		}
	}`
	writeSettingsFile(t, dir, settingsFile, seed)

	pluginsDir := filepath.Join(dir, "plugins")
	if err := os.MkdirAll(pluginsDir, 0o755); err != nil {
		t.Fatalf("mkdir plugins dir: %v", err)
	}
	installedPluginsFile := filepath.Join(pluginsDir, "installed_plugins.json")
	installedSeed := `{
  "plugins": {
    "chrome-devtools-mcp@chrome-devtools-plugins": [
      {
        "version": "1.2.0",
        "installedAt": "2026-01-01T00:00:00.000Z",
        "lastUpdated": "2026-01-01T00:00:00.000Z"
      }
    ],
    "chrome-devtools-mcp@claude-plugins-official": [
      {
        "version": "1.2.0",
        "installedAt": "2026-02-01T00:00:00.000Z",
        "lastUpdated": "2026-02-01T00:00:00.000Z"
      }
    ]
  }
}`
	if err := os.WriteFile(installedPluginsFile, []byte(installedSeed), 0o644); err != nil {
		t.Fatalf("write installed_plugins.json: %v", err)
	}
	before, err := os.ReadFile(installedPluginsFile)
	if err != nil {
		t.Fatalf("read installed_plugins.json before: %v", err)
	}

	if err := SetPluginEnabled("chrome-devtools-mcp@chrome-devtools-plugins", false); err != nil {
		t.Fatalf("SetPluginEnabled: %v", err)
	}
	if err := DedupePlugin("chrome-devtools-mcp", "chrome-devtools-mcp@claude-plugins-official"); err != nil {
		t.Fatalf("DedupePlugin: %v", err)
	}

	after, err := os.ReadFile(installedPluginsFile)
	if err != nil {
		t.Fatalf("read installed_plugins.json after: %v", err)
	}
	if string(before) != string(after) {
		t.Errorf("installed_plugins.json bytes changed:\nbefore: %s\nafter:  %s", before, after)
	}

	settings := readJSONMap(t, settingsFile)
	enabled := settings["enabledPlugins"].(map[string]any)
	want := map[string]any{"chrome-devtools-mcp@claude-plugins-official": true}
	if !reflect.DeepEqual(enabled, want) {
		t.Errorf("enabledPlugins = %v, want %v", enabled, want)
	}
}
