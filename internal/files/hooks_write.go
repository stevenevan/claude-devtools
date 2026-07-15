package files

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// HookEntry describes one hook matcher-group — either live in settings.json
// "hooks" (enabled) or stashed in the app-owned hooks-disabled.json
// (disabled). Matcher and Commands are carried verbatim; toggling never
// edits a command string, only moves the group between the two files.
type HookEntry struct {
	Event       string   `json:"event"`
	Matcher     string   `json:"matcher"`
	Commands    []string `json:"commands"`
	Fingerprint string   `json:"fingerprint"`
	Index       int      `json:"index"`
}

// HookView is the read model for the hooks manager panel.
type HookView struct {
	Enabled  []HookEntry `json:"enabled"`
	Disabled []HookEntry `json:"disabled"`
}

// hooksWriteMu guards hooks-disabled.json. Kept separate from
// settingsWriteMu — the two files are independent and must never share a
// lock (one editor's write shouldn't block on the other's).
var hooksWriteMu sync.Mutex

// Fingerprint returns a stable, truncated sha256 hex digest over a hook
// matcher-group's command strings, in order. Used by both ReadHooks (to
// label each entry) and ToggleHook (to verify a caller's snapshot still
// matches the on-disk group before moving it).
func Fingerprint(group any) string {
	m, _ := group.(map[string]any)
	matcher, _ := m["matcher"].(string)
	parts := append([]string{matcher}, groupCommands(m)...)
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return hex.EncodeToString(sum[:])[:16]
}

// groupCommands extracts each hooks[i].command string from a matcher-group,
// in order. A malformed entry yields "" rather than panicking.
func groupCommands(group map[string]any) []string {
	rawHooks, _ := group["hooks"].([]any)
	commands := make([]string, 0, len(rawHooks))
	for _, h := range rawHooks {
		hm, _ := h.(map[string]any)
		cmd, _ := hm["command"].(string)
		commands = append(commands, cmd)
	}
	return commands
}

// ReadHooks builds the enabled/disabled view for the hooks manager panel.
// Enabled comes from settings.json's "hooks" map (the CLI's own source of
// truth); Disabled comes from the app-owned hooks-disabled.json, which the
// CLI never reads. If a fingerprint appears in both (a crash mid-toggle left
// a duplicate), it is kept only in Enabled.
func ReadHooks(appDataDir string) (HookView, error) {
	settingsHooks, err := readSettingsHooks()
	if err != nil {
		return HookView{}, err
	}
	disabledHooks, err := readDisabledHooks(appDataDir)
	if err != nil {
		return HookView{}, err
	}

	enabled := buildEntries(settingsHooks)
	disabled := dedupeAgainstEnabled(buildEntries(disabledHooks), enabled)

	return HookView{Enabled: enabled, Disabled: disabled}, nil
}

func dedupeAgainstEnabled(disabled, enabled []HookEntry) []HookEntry {
	enabledFingerprints := make(map[string]bool, len(enabled))
	for _, e := range enabled {
		enabledFingerprints[e.Fingerprint] = true
	}
	deduped := make([]HookEntry, 0, len(disabled))
	for _, d := range disabled {
		if enabledFingerprints[d.Fingerprint] {
			continue
		}
		deduped = append(deduped, d)
	}
	return deduped
}

// buildEntries flattens an event->groups map (as decoded from JSON) into
// HookEntry values, sorted by event name for deterministic output.
func buildEntries(eventGroups map[string]any) []HookEntry {
	events := make([]string, 0, len(eventGroups))
	for ev := range eventGroups {
		events = append(events, ev)
	}
	sort.Strings(events)

	var entries []HookEntry
	for _, ev := range events {
		groups, _ := eventGroups[ev].([]any)
		for i, g := range groups {
			gm, ok := g.(map[string]any)
			if !ok {
				continue
			}
			matcher, _ := gm["matcher"].(string)
			entries = append(entries, HookEntry{
				Event:       ev,
				Matcher:     matcher,
				Commands:    groupCommands(gm),
				Fingerprint: Fingerprint(gm),
				Index:       i,
			})
		}
	}
	return entries
}

// readSettingsHooks reads settings.json fresh and returns its "hooks" map
// (event -> []group). A missing file is treated as no hooks.
func readSettingsHooks() (map[string]any, error) {
	cd, err := claudeDir()
	if err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(filepath.Join(cd, "settings.json"))
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]any{}, nil
		}
		return nil, fmt.Errorf("files: read settings.json: %w", err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, fmt.Errorf("files: parse settings.json: %w", err)
	}
	hooks, _ := m["hooks"].(map[string]any)
	return hooks, nil
}

// readDisabledHooks reads hooks-disabled.json fresh. Its shape mirrors
// settings.json's "hooks" map directly (event -> []group), with no wrapping
// key. A missing file is treated as no disabled hooks.
func readDisabledHooks(appDataDir string) (map[string]any, error) {
	raw, err := os.ReadFile(disabledHooksPath(appDataDir))
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]any{}, nil
		}
		return nil, fmt.Errorf("files: read hooks-disabled.json: %w", err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, fmt.Errorf("files: parse hooks-disabled.json: %w", err)
	}
	return m, nil
}

func disabledHooksPath(appDataDir string) string {
	return filepath.Join(appDataDir, "hooks-disabled.json")
}

// ToggleHook moves the matcher-group at (event, matcherIndex) between
// settings.json's "hooks" and the app-owned hooks-disabled.json. The caller
// must pass the fingerprint it last observed for that entry; a mismatch
// (the CLI or another toggle changed the file since) aborts with no write.
func ToggleHook(appDataDir, event string, matcherIndex int, fingerprint string, enable bool) error {
	if enable {
		return enableHook(appDataDir, event, matcherIndex, fingerprint)
	}
	return disableHook(appDataDir, event, matcherIndex, fingerprint)
}

// disableHook adds the group to hooks-disabled.json FIRST, then removes it
// from settings.json. A crash between the two leaves a harmless duplicate
// (ReadHooks dedupes in favor of Enabled), never a lost hook.
func disableHook(appDataDir, event string, matcherIndex int, fingerprint string) error {
	settingsHooks, err := readSettingsHooks()
	if err != nil {
		return err
	}
	group, err := groupAt(settingsHooks, event, matcherIndex, fingerprint)
	if err != nil {
		return err
	}

	if err := appendDisabledGroup(appDataDir, event, group); err != nil {
		return err
	}

	return MutateSettingsJSON(func(m map[string]any) error {
		popHookGroupByFingerprint(m, event, fingerprint)
		return nil
	})
}

// enableHook adds the group back into settings.json FIRST, then removes it
// from hooks-disabled.json. A crash between the two leaves a harmless
// duplicate, never a lost hook.
func enableHook(appDataDir, event string, matcherIndex int, fingerprint string) error {
	disabledHooks, err := readDisabledHooks(appDataDir)
	if err != nil {
		return err
	}
	group, err := groupAt(disabledHooks, event, matcherIndex, fingerprint)
	if err != nil {
		return err
	}

	if err := MutateSettingsJSON(func(m map[string]any) error {
		appendHookGroup(m, event, group)
		return nil
	}); err != nil {
		return err
	}

	return removeDisabledGroup(appDataDir, event, fingerprint)
}

// groupAt bounds-checks index against eventGroups[event] and verifies the
// group found there still matches fingerprint. Never indexes unchecked.
func groupAt(eventGroups map[string]any, event string, index int, fingerprint string) (map[string]any, error) {
	groups, _ := eventGroups[event].([]any)
	if index < 0 || index >= len(groups) {
		return nil, fmt.Errorf("files: hook index %d out of range for event %q", index, event)
	}
	group, ok := groups[index].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("files: hook group at %q[%d] is not an object", event, index)
	}
	if Fingerprint(group) != fingerprint {
		return nil, fmt.Errorf("hooks changed, reload")
	}
	return group, nil
}

// popHookGroupByFingerprint removes the group in m["hooks"][event] whose
// content fingerprint matches, wherever it currently sits. Locating by
// fingerprint (not the caller's index) is robust to a concurrent CLI rewrite
// reordering the slice between the caller's snapshot and this fresh read
// (the TOCTOU the fingerprint exists to close). A missing match (already gone)
// is a silent no-op — the add-before-remove step already succeeded.
func popHookGroupByFingerprint(m map[string]any, event, fingerprint string) {
	hooks, _ := m["hooks"].(map[string]any)
	if hooks == nil {
		return
	}
	groups, _ := hooks[event].([]any)
	for i, g := range groups {
		if Fingerprint(g) == fingerprint {
			hooks[event] = append(groups[:i], groups[i+1:]...)
			m["hooks"] = hooks
			return
		}
	}
}

// appendHookGroup appends group to m["hooks"][event], creating the "hooks"
// map or the event's slice if either is missing.
func appendHookGroup(m map[string]any, event string, group any) {
	hooks, ok := m["hooks"].(map[string]any)
	if !ok {
		hooks = map[string]any{}
	}
	groups, _ := hooks[event].([]any)
	hooks[event] = append(groups, group)
	m["hooks"] = hooks
}

// mutateDisabledHooks is the sole read-modify-atomic-write cycle for
// hooks-disabled.json, guarded by hooksWriteMu. Mirrors MutateSettingsJSON's
// read-fresh + .bak + temp-rename idiom for its own file.
func mutateDisabledHooks(appDataDir string, mutate func(m map[string]any)) error {
	hooksWriteMu.Lock()
	defer hooksWriteMu.Unlock()

	if err := os.MkdirAll(appDataDir, 0o755); err != nil {
		return fmt.Errorf("files: mkdir app data dir: %w", err)
	}

	path := disabledHooksPath(appDataDir)
	raw, err := os.ReadFile(path)
	fileExists := err == nil
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("files: read hooks-disabled.json: %w", err)
	}

	m := map[string]any{}
	if fileExists {
		if err := json.Unmarshal(raw, &m); err != nil {
			return fmt.Errorf("files: parse hooks-disabled.json: %w", err)
		}
		if err := os.WriteFile(path+".bak", raw, 0o644); err != nil {
			return fmt.Errorf("files: write hooks-disabled.json.bak: %w", err)
		}
	}

	mutate(m)

	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return fmt.Errorf("files: marshal hooks-disabled.json: %w", err)
	}
	return atomicWriteFile(path, data)
}

func appendDisabledGroup(appDataDir, event string, group any) error {
	return mutateDisabledHooks(appDataDir, func(m map[string]any) {
		groups, _ := m[event].([]any)
		m[event] = append(groups, group)
	})
}

// AddDisabledHookGroups appends imported hook matcher-groups straight into
// hooks-disabled.json (event -> []group), leaving them DISABLED — the CLI
// never reads that file. Config import routes untrusted hooks here because,
// unlike ToggleHook/disableHook (which require the group to already be LIVE in
// settings.json before moving it), this inserts a group that was never in
// settings.json and must never be — writing an untrusted hook into settings.json
// even transiently would arm it on the next `claude` run. Append is per-event
// and fingerprint-deduped so a repeated import doesn't pile up identical groups.
// A single R-M-W through mutateDisabledHooks; never touches settings.json.
func AddDisabledHookGroups(appDataDir string, groups map[string][]any) error {
	if len(groups) == 0 {
		return nil
	}
	return mutateDisabledHooks(appDataDir, func(m map[string]any) {
		for event, incoming := range groups {
			existing, _ := m[event].([]any)
			seen := make(map[string]bool, len(existing))
			for _, g := range existing {
				seen[Fingerprint(g)] = true
			}
			for _, g := range incoming {
				fp := Fingerprint(g)
				if seen[fp] {
					continue
				}
				seen[fp] = true
				existing = append(existing, g)
			}
			m[event] = existing
		}
	})
}

// removeDisabledGroup removes the hooks-disabled.json[event] group whose
// content fingerprint matches, wherever it sits. Fingerprint-located (not
// index) for the same TOCTOU robustness as popHookGroupByFingerprint. A
// missing match (already gone) is a silent no-op.
func removeDisabledGroup(appDataDir, event, fingerprint string) error {
	return mutateDisabledHooks(appDataDir, func(m map[string]any) {
		groups, _ := m[event].([]any)
		for i, g := range groups {
			if Fingerprint(g) == fingerprint {
				m[event] = append(groups[:i], groups[i+1:]...)
				return
			}
		}
	})
}

// atomicWriteFile writes data to path via temp+rename. Local to this file
// (rather than reusing atomicWriteSettings) so error messages name the
// right file.
func atomicWriteFile(path string, data []byte) error {
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0o644); err != nil {
		return fmt.Errorf("files: write %s: %w", filepath.Base(tmpPath), err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("files: rename %s: %w", filepath.Base(tmpPath), err)
	}
	return nil
}
