package configbackup

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"

	"claude-devtools/internal/files"
)

// Zip-bomb / fail-closed caps for an untrusted import archive.
const (
	maxImportEntries    = 2000
	maxEntryBytes       = 8 << 20  // 8 MiB per decompressed entry
	maxTotalImportBytes = 64 << 20 // 64 MiB total decompressed
)

// ImportPreview is the fail-closed review a caller must approve before
// ApplyImport. It enumerates EVERY hook command string (full text) and EVERY
// permission rule the imported settings.json carries, plus whether the archive
// was exported with secrets.
type ImportPreview struct {
	HookCommands    []string `json:"hookCommands"`
	PermissionRules []string `json:"permissionRules"`
	Categories      []string `json:"categories"`
	SecretsIncluded bool     `json:"secretsIncluded"`
	ArchivePath     string   `json:"archivePath"`
}

// ValidateImport opens the archive and, with ZERO disk writes, fail-closed:
// iterates the ACTUAL zip entries (never the manifest's self-reported list),
// rejecting any name that is absolute, contains a ".." segment (zip-slip), or
// falls outside the allowlist; caps per-entry / total bytes and entry count
// (zip bomb); typed-schema-validates the manifest + each file's shape. It
// returns the review preview enumerating the imported hooks + permission rules.
func ValidateImport(archivePath string) (ImportPreview, error) {
	entries, manifest, err := readValidatedArchive(archivePath)
	if err != nil {
		return ImportPreview{}, err
	}

	preview := ImportPreview{
		SecretsIncluded: manifest.SecretsIncluded,
		ArchivePath:     archivePath,
		HookCommands:    []string{},
		PermissionRules: []string{},
		Categories:      distinctCategories(entries),
	}
	if settings, ok := entries["settings.json"]; ok {
		preview.HookCommands = extractHookCommands(settings)
		preview.PermissionRules = extractPermissionRules(settings)
	}
	return preview, nil
}

// distinctCategories returns the sorted set of non-empty categories the archive's
// allowlisted entries belong to — the per-category confirm set for the review UI.
func distinctCategories(entries map[string][]byte) []string {
	seen := map[string]bool{}
	for rel := range entries {
		if cat := categoryForRel(rel); cat != "" {
			seen[cat] = true
		}
	}
	out := make([]string, 0, len(seen))
	for cat := range seen {
		out = append(out, cat)
	}
	sort.Strings(out)
	return out
}

// ApplyImport applies the confirmed categories of the archive.
//  1. Take a pre-import auto-snapshot (incl. hooks-disabled.json) so undo fully
//     reverts.
//  2. If the "settings" category is confirmed: parse the imported settings map,
//     delete(m,"hooks") — the CORE ACE fix, since ReplaceSettingsJSON writes
//     wholesale and an unstripped hooks block would arm on the next `claude`
//     run — drop any value equal to the redaction placeholder, then write the
//     hooks-stripped map via files.ReplaceSettingsJSON.
//  3. Route the extracted hooks groups through files.AddDisabledHookGroups →
//     hooks-disabled.json, DISABLED. Hooks are never written into settings.json,
//     even transiently.
//
// Every other confirmed allowlisted file is written via confineImportDest +
// temp+rename with a .bak.
func ApplyImport(root, appDataDir, archivePath string, confirmedCategories []string) error {
	if _, err := CaptureConfig(root, appDataDir, "pre-import", true); err != nil {
		return fmt.Errorf("configbackup: pre-import snapshot: %w", err)
	}

	entries, _, err := readValidatedArchive(archivePath)
	if err != nil {
		return err
	}

	confirmed := make(map[string]bool, len(confirmedCategories))
	for _, c := range confirmedCategories {
		confirmed[c] = true
	}

	canonRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return fmt.Errorf("configbackup: resolve root %q: %w", root, err)
	}

	if confirmed["settings"] {
		if settingsBytes, ok := entries["settings.json"]; ok {
			hooksGroups, stripped, err := stripHooksFromSettings(settingsBytes)
			if err != nil {
				return err
			}
			if err := files.ReplaceSettingsJSON(stripped); err != nil {
				return fmt.Errorf("configbackup: apply settings.json: %w", err)
			}
			if err := files.AddDisabledHookGroups(appDataDir, hooksGroups); err != nil {
				return fmt.Errorf("configbackup: stash imported hooks disabled: %w", err)
			}
		}
	}

	for rel, data := range entries {
		if filepath.Clean(rel) == "settings.json" {
			continue // handled above (hooks-stripped)
		}
		if !confirmed[categoryForRel(rel)] {
			continue
		}
		dest, err := confineImportDest(canonRoot, rel)
		if err != nil {
			return err
		}
		if err := writeFileWithBak(dest, data); err != nil {
			return fmt.Errorf("configbackup: apply %q: %w", rel, err)
		}
	}
	return nil
}

// readValidatedArchive is the shared fail-closed reader for ValidateImport and
// ApplyImport. It returns the allowlisted, size-capped, shape-validated file
// entries (root-relative key => bytes) plus the schema-validated manifest, or
// an error on the FIRST violation. Never writes to disk.
func readValidatedArchive(archivePath string) (map[string][]byte, Manifest, error) {
	zr, err := zip.OpenReader(archivePath)
	if err != nil {
		return nil, Manifest{}, fmt.Errorf("configbackup: open archive: %w", err)
	}
	defer zr.Close()

	if len(zr.File) > maxImportEntries {
		return nil, Manifest{}, fmt.Errorf("configbackup: archive has too many entries (%d > %d)", len(zr.File), maxImportEntries)
	}

	entries := map[string][]byte{}
	var manifestBytes []byte
	var total int64

	for _, f := range zr.File {
		if err := validateArchiveEntryName(f.Name); err != nil {
			return nil, Manifest{}, err
		}
		if strings.HasSuffix(f.Name, "/") {
			continue // directory entry — no content
		}
		rel := filepath.FromSlash(f.Name)
		isManifest := f.Name == "manifest.json"
		if !isManifest && !matchConfigAllowlist(rel) {
			return nil, Manifest{}, fmt.Errorf("configbackup: archive entry %q is not in the allowlist", f.Name)
		}

		data, err := readZipEntryLimited(f)
		if err != nil {
			return nil, Manifest{}, err
		}
		total += int64(len(data))
		if total > maxTotalImportBytes {
			return nil, Manifest{}, fmt.Errorf("configbackup: archive exceeds the total size cap")
		}

		if isManifest {
			manifestBytes = data
			continue
		}
		if err := validateEntryShape(f.Name, data); err != nil {
			return nil, Manifest{}, err
		}
		entries[rel] = data
	}

	if manifestBytes == nil {
		return nil, Manifest{}, fmt.Errorf("configbackup: archive has no manifest.json")
	}
	manifest, err := validateManifestSchema(manifestBytes)
	if err != nil {
		return nil, Manifest{}, err
	}
	return entries, manifest, nil
}

// validateArchiveEntryName rejects absolute names and any "/"- or "\"-delimited
// ".." segment (zip-slip), before the name is ever trusted.
func validateArchiveEntryName(name string) error {
	if name == "" {
		return fmt.Errorf("configbackup: empty archive entry name")
	}
	if strings.HasPrefix(name, "/") || filepath.IsAbs(name) {
		return fmt.Errorf("configbackup: archive entry %q is absolute", name)
	}
	for _, seg := range strings.FieldsFunc(name, func(r rune) bool { return r == '/' || r == '\\' }) {
		if seg == ".." {
			return fmt.Errorf("configbackup: archive entry %q contains a parent traversal", name)
		}
	}
	return nil
}

// readZipEntryLimited reads one entry through an io.LimitReader, rejecting an
// entry whose decompressed size exceeds the per-entry cap (zip bomb).
func readZipEntryLimited(f *zip.File) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, fmt.Errorf("configbackup: open archive entry %q: %w", f.Name, err)
	}
	defer rc.Close()
	data, err := io.ReadAll(io.LimitReader(rc, maxEntryBytes+1))
	if err != nil {
		return nil, fmt.Errorf("configbackup: read archive entry %q: %w", f.Name, err)
	}
	if int64(len(data)) > maxEntryBytes {
		return nil, fmt.Errorf("configbackup: archive entry %q exceeds the per-entry size cap", f.Name)
	}
	return data, nil
}

// validateEntryShape typed-checks one file's expected shape: settings.json must
// be a JSON object, any .json must be valid JSON, everything else must be valid
// UTF-8 text (rules/commands/tools/agents/memory/skills files).
func validateEntryShape(name string, data []byte) error {
	if filepath.FromSlash(name) == "settings.json" {
		var m map[string]any
		if err := json.Unmarshal(data, &m); err != nil {
			return fmt.Errorf("configbackup: settings.json is not a JSON object: %w", err)
		}
		return nil
	}
	if strings.HasSuffix(name, ".json") {
		if !json.Valid(data) {
			return fmt.Errorf("configbackup: entry %q is not valid JSON", name)
		}
		return nil
	}
	if !utf8.Valid(data) {
		return fmt.Errorf("configbackup: entry %q is not valid UTF-8 text", name)
	}
	return nil
}

// validateManifestSchema strictly decodes the manifest, rejecting any unknown /
// extra field, and requires a non-empty id.
func validateManifestSchema(data []byte) (Manifest, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var m Manifest
	if err := dec.Decode(&m); err != nil {
		return Manifest{}, fmt.Errorf("configbackup: invalid manifest schema: %w", err)
	}
	if m.ID == "" {
		return Manifest{}, fmt.Errorf("configbackup: manifest is missing an id")
	}
	return m, nil
}

// stripHooksFromSettings parses the imported settings.json, extracts and removes
// its "hooks" block, drops any value equal to the redaction placeholder, and
// returns (the extracted groups, the hooks-stripped marshaled bytes).
func stripHooksFromSettings(settingsBytes []byte) (map[string][]any, []byte, error) {
	var m map[string]any
	if err := json.Unmarshal(settingsBytes, &m); err != nil {
		return nil, nil, fmt.Errorf("configbackup: parse imported settings.json: %w", err)
	}
	groups := extractHookGroups(m["hooks"])
	delete(m, "hooks")
	dropPlaceholderValues(m)
	out, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return nil, nil, fmt.Errorf("configbackup: marshal hooks-stripped settings: %w", err)
	}
	return groups, out, nil
}

// extractHookGroups converts a settings "hooks" value (event -> []group) into
// the map[string][]any AddDisabledHookGroups consumes.
func extractHookGroups(hooksVal any) map[string][]any {
	hooks, ok := hooksVal.(map[string]any)
	if !ok {
		return nil
	}
	out := map[string][]any{}
	for event, v := range hooks {
		if groups, ok := v.([]any); ok && len(groups) > 0 {
			out[event] = groups
		}
	}
	return out
}

// dropPlaceholderValues recursively deletes any object key whose string value
// equals the redaction placeholder (F11 — never write a masked marker live).
func dropPlaceholderValues(v any) {
	switch t := v.(type) {
	case map[string]any:
		for k, val := range t {
			if s, ok := val.(string); ok && s == redactionPlaceholder {
				delete(t, k)
				continue
			}
			dropPlaceholderValues(val)
		}
	case []any:
		for _, e := range t {
			dropPlaceholderValues(e)
		}
	}
}

// extractHookCommands enumerates every "command" string under settings "hooks".
func extractHookCommands(settingsBytes []byte) []string {
	var m map[string]any
	if json.Unmarshal(settingsBytes, &m) != nil {
		return []string{}
	}
	out := []string{}
	collectHookCommands(m["hooks"], &out)
	return out
}

func collectHookCommands(v any, out *[]string) {
	switch t := v.(type) {
	case map[string]any:
		for k, val := range t {
			if k == "command" {
				if s, ok := val.(string); ok {
					*out = append(*out, s)
				}
			}
			collectHookCommands(val, out)
		}
	case []any:
		for _, e := range t {
			collectHookCommands(e, out)
		}
	}
}

// extractPermissionRules enumerates every permissions.{allow,deny,ask} rule.
func extractPermissionRules(settingsBytes []byte) []string {
	var m map[string]any
	if json.Unmarshal(settingsBytes, &m) != nil {
		return []string{}
	}
	out := []string{}
	perms, _ := m["permissions"].(map[string]any)
	for _, list := range []string{"allow", "deny", "ask"} {
		arr, _ := perms[list].([]any)
		for _, r := range arr {
			if s, ok := r.(string); ok {
				out = append(out, s)
			}
		}
	}
	return out
}
