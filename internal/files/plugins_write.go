package files

import (
	"sort"
	"strings"
)

// DuplicateGroup is one plugin Name that is enabled under 2+ distinct
// marketplaces at once — the CLI has no defined precedence for this, so the
// UI surfaces it and lets the user pick which marketplace to keep.
type DuplicateGroup struct {
	Name    string   `json:"name"`
	Entries []Plugin `json:"entries"`
}

// DetectPluginDuplicates groups plugins by Name and flags any group with 2+
// entries Enabled under distinct Marketplace values. Pure — no IO, operates
// on the already-read output of ReadGlobalPlugins. Returned groups are
// sorted by Name, and each group's Entries sorted by Marketplace, for
// deterministic output.
func DetectPluginDuplicates(plugins []Plugin) []DuplicateGroup {
	byName := make(map[string][]Plugin)
	for _, p := range plugins {
		byName[p.Name] = append(byName[p.Name], p)
	}

	var groups []DuplicateGroup
	for name, entries := range byName {
		var enabledEntries []Plugin
		marketplaces := make(map[string]bool)
		for _, e := range entries {
			if !e.Enabled {
				continue
			}
			enabledEntries = append(enabledEntries, e)
			marketplaces[e.Marketplace] = true
		}
		if len(marketplaces) < 2 {
			continue
		}
		sort.Slice(enabledEntries, func(i, j int) bool {
			return enabledEntries[i].Marketplace < enabledEntries[j].Marketplace
		})
		groups = append(groups, DuplicateGroup{Name: name, Entries: enabledEntries})
	}

	sort.Slice(groups, func(i, j int) bool { return groups[i].Name < groups[j].Name })
	return groups
}

// SetPluginEnabled adds or removes key (a "plugin@marketplace" id, or
// occasionally a bare plugin name) in settings.json's "enabledPlugins" map,
// preserving every other key and every other entry. Touches nothing under
// plugins/ — installed_plugins.json and any plugin cache are never read or
// written here.
func SetPluginEnabled(key string, enable bool) error {
	return MutateSettingsJSON(func(m map[string]any) error {
		enabled := enabledPluginsMap(m)
		if enable {
			enabled[key] = true
		} else {
			delete(enabled, key)
		}
		m["enabledPlugins"] = enabled
		return nil
	})
}

// DedupePlugin removes every "enabledPlugins" key whose plugin-name part
// equals name, except keepKey. This also removes a bare "<name>" key (name
// with no "@marketplace" suffix), which would otherwise keep every
// marketplace enabled regardless of the per-marketplace keys. The caller
// chooses keepKey — this never auto-picks a survivor.
func DedupePlugin(name, keepKey string) error {
	return MutateSettingsJSON(func(m map[string]any) error {
		enabled := enabledPluginsMap(m)
		for key := range enabled {
			if key == keepKey {
				continue
			}
			if pluginNamePart(key) == name {
				delete(enabled, key)
			}
		}
		m["enabledPlugins"] = enabled
		return nil
	})
}

// enabledPluginsMap reads m["enabledPlugins"] as a map, creating an empty
// one if absent or of the wrong type. Existing entries and their value
// types (some are legacy non-bool) are preserved as-is.
func enabledPluginsMap(m map[string]any) map[string]any {
	enabled, ok := m["enabledPlugins"].(map[string]any)
	if !ok {
		enabled = map[string]any{}
	}
	return enabled
}

// pluginNamePart returns the substring of key before "@", or key unchanged
// if it has no "@". Mirrors the id-splitting in ReadGlobalPlugins.
func pluginNamePart(key string) string {
	if at := strings.IndexRune(key, '@'); at >= 0 {
		return key[:at]
	}
	return key
}
