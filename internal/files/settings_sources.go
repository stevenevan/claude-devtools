package files

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// Settings source Kind values.
const (
	KindGlobal              = "global"
	KindGlobalNestedAnomaly = "global-nested-anomaly"
	KindProject             = "project"
	KindProjectLocal        = "project-local"
)

// Source is one settings.json/settings.local.json location on disk. Raw is
// the file's exact text, unmasked — masking happens client-side at render.
// NEVER pass a Source to a logger; Raw may hold secrets (env values, tokens).
type Source struct {
	Path      string `json:"path"`
	Kind      string `json:"kind"`
	Exists    bool   `json:"exists"`
	IsAnomaly bool   `json:"isAnomaly"`
	Raw       string `json:"raw"`
}

// SourcesView is the full settings-source enumeration for a project: every
// source plus a merged, provenance-tracked effective view.
type SourcesView struct {
	Sources    []Source          `json:"sources"`
	Merged     map[string]any    `json:"merged"`
	Provenance map[string]string `json:"provenance"`
}

// EnumerateSettingsSources surfaces every settings.json/settings.local.json
// that could affect projectRoot: global, a stray nested-global anomaly (a
// .claude/ dir INSIDE ~/.claude — a permission grant no one would look for),
// project, and project-local. It is read-only and never logs file content.
func EnumerateSettingsSources(projectRoot string) (SourcesView, error) {
	cd, err := claudeDir()
	if err != nil {
		return SourcesView{}, fmt.Errorf("files: enumerate settings sources: %w", err)
	}

	global := readSource(filepath.Join(cd, "settings.json"), KindGlobal, false)
	sources := []Source{global}
	sources = append(sources, nestedAnomalySources(cd)...)

	project := readSource(filepath.Join(projectRoot, ".claude", "settings.json"), KindProject, false)
	projectLocal := readSource(filepath.Join(projectRoot, ".claude", "settings.local.json"), KindProjectLocal, false)
	sources = append(sources, project, projectLocal)

	merged, provenance := mergeSources(global, project, projectLocal)

	return SourcesView{Sources: sources, Merged: merged, Provenance: provenance}, nil
}

// nestedAnomalySources surfaces settings.local.json (always, once the nested
// dir exists) and settings.json (only if present) from a stray .claude/
// directory nested inside the global claudeDir.
func nestedAnomalySources(cd string) []Source {
	nestedDir := filepath.Join(cd, ".claude")
	info, err := os.Stat(nestedDir)
	if err != nil || !info.IsDir() {
		return nil
	}

	nestedLocal := readSource(filepath.Join(nestedDir, "settings.local.json"), KindGlobalNestedAnomaly, true)
	out := []Source{nestedLocal}
	if nestedGlobal := readSource(filepath.Join(nestedDir, "settings.json"), KindGlobalNestedAnomaly, true); nestedGlobal.Exists {
		out = append(out, nestedGlobal)
	}
	return out
}

// readSource reads path's exact text. A missing file is Exists:false with
// empty Raw; any other read error is tolerated the same way — this call must
// never fail the whole enumeration over one unreadable source.
func readSource(path, kind string, isAnomaly bool) Source {
	raw, err := os.ReadFile(path)
	if err != nil {
		return Source{Path: path, Kind: kind, Exists: false, IsAnomaly: isAnomaly, Raw: ""}
	}
	return Source{Path: path, Kind: kind, Exists: true, IsAnomaly: isAnomaly, Raw: string(raw)}
}

// mergeSources shallow-merges top-level keys from sources in precedence
// order (later wins), recording per-key provenance. This is the app's
// best-effort model of CLI precedence, not CLI ground truth. The nested
// global anomaly is deliberately excluded from both the merge and its
// sources argument here — it is a stray location the CLI likely never
// reads, not a genuine precedence tier. A source that is missing or fails
// to parse as a JSON object is skipped for merge purposes only; it still
// appears in SourcesView.Sources with its Raw intact.
func mergeSources(sources ...Source) (map[string]any, map[string]string) {
	merged := map[string]any{}
	provenance := map[string]string{}
	for _, s := range sources {
		if !s.Exists {
			continue
		}
		var parsed map[string]any
		if err := json.Unmarshal([]byte(s.Raw), &parsed); err != nil {
			continue
		}
		for k, v := range parsed {
			merged[k] = v
			provenance[k] = s.Path
		}
	}
	return merged, provenance
}
