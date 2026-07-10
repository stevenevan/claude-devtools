package maintenance

import (
	"context"
	"path/filepath"
)

func init() { registerMatcher("plugins", 0, scanPlugins) } // no age gate: staleness = disabled

// scanPlugins surfaces reclaimable plugin storage under <root>/plugins:
//   - cache/<marketplace>/<plugin>/  — per-plugin cached repo (two levels deep),
//     cross-referenced against enabled plugins so a disabled/uninstalled plugin's
//     cache is flagged as a prime reclaim candidate and an enabled plugin's cache
//     is flagged safe-but-forces-redownload.
//   - marketplaces/<name>/  — per-marketplace metadata.
//   - repos/<name>/         — per cached repo.
//
// The matcher scopes strictly to cache/marketplaces/repos; plugins/ also holds
// data/, *.json and marker files that are config, not reclaimable cache. No age
// gate — plugin cache is regenerable, staleness is decided by enabled-state.
func scanPlugins(ctx context.Context, spec CategorySpec) ([]Candidate, error) {
	pluginsDir := filepath.Join(spec.Root, "plugins")
	enabled := make(map[string]bool, len(spec.Enabled))
	for _, k := range spec.Enabled {
		enabled[k] = true
	}

	out := []Candidate{}

	cache, err := scanPluginCache(ctx, filepath.Join(pluginsDir, "cache"), enabled)
	if err != nil {
		return nil, err
	}
	out = append(out, cache...)

	markets, err := scanPluginChildren(ctx, filepath.Join(pluginsDir, "marketplaces"), "marketplaces", "marketplace metadata")
	if err != nil {
		return nil, err
	}
	out = append(out, markets...)

	repos, err := scanPluginChildren(ctx, filepath.Join(pluginsDir, "repos"), "repos", "cached repo")
	if err != nil {
		return nil, err
	}
	out = append(out, repos...)

	// Anomaly: repos/ empty while cache/ holds data (audit found this broken/
	// legacy layout). Surface it as an informational flag on the cache
	// candidates — never auto-delete anything on account of it.
	if len(repos) == 0 && len(cache) > 0 {
		reposEntries, ok, _ := openDirNoSymlink(filepath.Join(pluginsDir, "repos"))
		if ok && len(reposEntries) == 0 {
			for i := range out {
				if out[i].Group == "cache" {
					stampMeta(&out[i], "layoutAnomaly", "repos-empty")
				}
			}
		}
	}

	return out, nil
}

// scanPluginCache walks cache/<marketplace>/<plugin>, one candidate per plugin.
func scanPluginCache(ctx context.Context, cacheDir string, enabled map[string]bool) ([]Candidate, error) {
	markets, ok, err := openDirNoSymlink(cacheDir)
	if err != nil || !ok {
		return []Candidate{}, err
	}

	out := []Candidate{}
	for _, market := range markets {
		if !market.IsDir() {
			continue
		}
		marketDir := filepath.Join(cacheDir, market.Name())
		plugins, ok, err := openDirNoSymlink(marketDir)
		if err != nil {
			return nil, err
		}
		if !ok {
			continue
		}
		for _, plugin := range plugins {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			if !plugin.IsDir() {
				continue
			}
			pluginDir := filepath.Join(marketDir, plugin.Name())
			bytes, files, newest, err := subtreeStats(ctx, pluginDir)
			if err != nil {
				return nil, err
			}
			isEnabled := enabled[plugin.Name()+"@"+market.Name()] || enabled[plugin.Name()]
			reason := "cached data for a disabled or uninstalled plugin"
			if isEnabled {
				reason = "cached data for an enabled plugin — safe to remove but forces a re-download on next use"
			}
			c := Candidate{
				Path: pluginDir, Bytes: bytes, Files: files, ModTime: newest,
				Reason: reason, Group: "cache",
				Meta: map[string]string{
					"marketplace": market.Name(),
					"plugin":      plugin.Name(),
					"enabled":     boolStr(isEnabled),
				},
			}
			out = append(out, c)
		}
	}
	return out, nil
}

// scanPluginChildren emits one candidate per immediate child dir of dir.
func scanPluginChildren(ctx context.Context, dir, group, reason string) ([]Candidate, error) {
	entries, ok, err := openDirNoSymlink(dir)
	if err != nil || !ok {
		return []Candidate{}, err
	}

	out := []Candidate{}
	for _, e := range entries {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if !e.IsDir() {
			continue
		}
		child := filepath.Join(dir, e.Name())
		bytes, files, newest, err := subtreeStats(ctx, child)
		if err != nil {
			return nil, err
		}
		out = append(out, Candidate{
			Path: child, Bytes: bytes, Files: files, ModTime: newest,
			Reason: reason, Group: group,
			Meta: map[string]string{"name": e.Name()},
		})
	}
	return out, nil
}

func stampMeta(c *Candidate, k, v string) {
	if c.Meta == nil {
		c.Meta = map[string]string{}
	}
	c.Meta[k] = v
}

func boolStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}
