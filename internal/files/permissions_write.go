// permissions_write.go is the Week 19 write path for permission rules that
// live scattered across global ~/.claude/settings.json and each project's
// .claude/settings.local.json. It only ever adds/removes ONE opaque rule
// string in permissions.{allow,deny,ask}, preserving every other key — never
// a full-replace. Global writes route through the single MutateSettingsJSON
// writer; project-local writes go through mutateLocalSettings (its own mutex),
// with the same confine-PARENT-to-root safety as text_write.go.
package files

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// PermissionList is one of the three opaque permission-list keys.
type PermissionList = string

// Permission list keys. Anything else is rejected before any I/O.
const (
	PermAllow = "allow"
	PermDeny  = "deny"
	PermAsk   = "ask"
)

// Writable scope kinds. Display-only sources (KindProject,
// KindGlobalNestedAnomaly) must never reach the writer.
const (
	ScopeGlobal       = "global"
	ScopeProjectLocal = "project-local"
)

// PermissionScope names a writable settings file. Kind is "global"
// (~/.claude/settings.json) or "project-local" ({ProjectRoot}/.claude/
// settings.local.json); ProjectRoot is only used for the project-local kind.
type PermissionScope struct {
	Kind        string `json:"kind"`
	ProjectRoot string `json:"projectRoot"`
}

// PermissionRuleRow is one permission rule with its provenance. Writable is
// true only for the two editable sources (global + project-local); committed
// project and nested-anomaly rows are display-only.
type PermissionRuleRow struct {
	Rule       string `json:"rule"`
	List       string `json:"list"`
	SourceKind string `json:"sourceKind"`
	SourcePath string `json:"sourcePath"`
	Writable   bool   `json:"writable"`
}

// PermissionRulesView is the merged rule table for a project.
type PermissionRulesView struct {
	Rows []PermissionRuleRow `json:"rows"`
}

// settingsLocalWriteMu serializes every settings.local.json write. One lock
// for the whole family (not a per-path map) — the instructionWriteMu
// precedent: read-fresh-under-lock kills the lost-update race, and two
// different project files never need concurrent human-driven writes.
var settingsLocalWriteMu sync.Mutex

func validatePermissionList(list string) error {
	switch list {
	case PermAllow, PermDeny, PermAsk:
		return nil
	}
	return fmt.Errorf("files: invalid permission list %q (want allow|deny|ask)", list)
}

func validateScopeKind(kind string) error {
	switch kind {
	case ScopeGlobal, ScopeProjectLocal:
		return nil
	}
	return fmt.Errorf("files: invalid permission scope kind %q (want global|project-local)", kind)
}

// GetPermissionRules reuses EnumerateSettingsSources and extracts only the
// permissions.{allow,deny,ask} arrays from each source — Raw is never exposed.
func GetPermissionRules(projectRoot string) (PermissionRulesView, error) {
	view, err := EnumerateSettingsSources(projectRoot)
	if err != nil {
		return PermissionRulesView{}, err
	}
	rows := make([]PermissionRuleRow, 0)
	for _, src := range view.Sources {
		if !src.Exists {
			continue
		}
		rows = append(rows, permissionRowsFromSource(src)...)
	}
	return PermissionRulesView{Rows: rows}, nil
}

// permissionRowsFromSource parses a single source's Raw and yields its
// permission rows. Only global + project-local sources are writable.
func permissionRowsFromSource(src Source) []PermissionRuleRow {
	var parsed map[string]any
	if err := json.Unmarshal([]byte(src.Raw), &parsed); err != nil {
		return nil
	}
	perms, ok := parsed["permissions"].(map[string]any)
	if !ok {
		return nil
	}
	writable := src.Kind == KindGlobal || src.Kind == KindProjectLocal
	var rows []PermissionRuleRow
	for _, list := range []string{PermAllow, PermDeny, PermAsk} {
		arr, _ := perms[list].([]any)
		for _, v := range arr {
			rule, ok := v.(string)
			if !ok {
				continue
			}
			rows = append(rows, PermissionRuleRow{
				Rule:       rule,
				List:       list,
				SourceKind: src.Kind,
				SourcePath: src.Path,
				Writable:   writable,
			})
		}
	}
	return rows
}

// AddPermissionRule appends rule to scope's permissions[list], preserving all
// other keys. Rejects a bad list or scope kind before any file I/O.
func AddPermissionRule(scope PermissionScope, list, rule string) error {
	if err := validatePermissionList(list); err != nil {
		return err
	}
	if err := validateScopeKind(scope.Kind); err != nil {
		return err
	}
	return mutatePermissions(scope, func(m map[string]any) error {
		appendRuleToPermissions(m, list, rule)
		return nil
	})
}

// RemovePermissionRule drops every occurrence equal to rule from scope's
// permissions[list], preserving all other keys. Rejects a bad list or scope
// kind before any file I/O.
func RemovePermissionRule(scope PermissionScope, list, rule string) error {
	if err := validatePermissionList(list); err != nil {
		return err
	}
	if err := validateScopeKind(scope.Kind); err != nil {
		return err
	}
	return mutatePermissions(scope, func(m map[string]any) error {
		removeRuleFromPermissions(m, list, rule)
		return nil
	})
}

// MovePermissionRule adds rule to the TARGET first (one atomic write), then
// removes it from the SOURCE (a second atomic write). A crash between the two
// leaves a harmless duplicate, never a lost rule. All four inputs are
// validated up front so a bad source scope can't leave a half-applied add.
func MovePermissionRule(from, to PermissionScope, fromList, toList, rule string) error {
	if err := validatePermissionList(fromList); err != nil {
		return err
	}
	if err := validatePermissionList(toList); err != nil {
		return err
	}
	if err := validateScopeKind(from.Kind); err != nil {
		return err
	}
	if err := validateScopeKind(to.Kind); err != nil {
		return err
	}
	if err := AddPermissionRule(to, toList, rule); err != nil {
		return err
	}
	return RemovePermissionRule(from, fromList, rule)
}

// mutatePermissions dispatches to the correct writer for scope.Kind. Callers
// validate the kind first; the default is a defensive guard.
func mutatePermissions(scope PermissionScope, mutate func(m map[string]any) error) error {
	switch scope.Kind {
	case ScopeGlobal:
		return MutateSettingsJSON(mutate)
	case ScopeProjectLocal:
		return mutateLocalSettings(scope.ProjectRoot, mutate)
	}
	return fmt.Errorf("files: invalid permission scope kind %q", scope.Kind)
}

// appendRuleToPermissions appends rule to m["permissions"][list], creating the
// permissions map or the list slice if either is missing.
func appendRuleToPermissions(m map[string]any, list, rule string) {
	perms, ok := m["permissions"].(map[string]any)
	if !ok {
		perms = map[string]any{}
	}
	existing, _ := perms[list].([]any)
	perms[list] = append(existing, rule)
	m["permissions"] = perms
}

// removeRuleFromPermissions drops every entry equal to rule from
// m["permissions"][list]. A missing permissions map is a silent no-op.
func removeRuleFromPermissions(m map[string]any, list, rule string) {
	perms, ok := m["permissions"].(map[string]any)
	if !ok {
		return
	}
	existing, _ := perms[list].([]any)
	filtered := make([]any, 0, len(existing))
	for _, v := range existing {
		if s, ok := v.(string); ok && s == rule {
			continue
		}
		filtered = append(filtered, v)
	}
	perms[list] = filtered
	m["permissions"] = perms
}

// mutateLocalSettings is the sole read-modify-atomic-write cycle for a
// project's settings.local.json, guarded by settingsLocalWriteMu. Mirrors
// MutateSettingsJSON's read-fresh + .bak + temp-rename idiom, but for a
// project-scoped file: the parent {projectRoot}/.claude dir is confined to
// root (never the not-yet-existing leaf), and both the .bak and the final
// write use 0o600 because settings.local.json can hold env secrets.
func mutateLocalSettings(projectRoot string, mutate func(m map[string]any) error) error {
	settingsLocalWriteMu.Lock()
	defer settingsLocalWriteMu.Unlock()

	path, err := resolveLocalSettingsPath(projectRoot)
	if err != nil {
		return err
	}

	raw, err := os.ReadFile(path)
	fileExists := err == nil
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("files: read settings.local.json: %w", err)
	}

	m := map[string]any{}
	if fileExists {
		if err := json.Unmarshal(raw, &m); err != nil {
			return fmt.Errorf("files: parse settings.local.json: %w", err)
		}
		if err := os.WriteFile(path+".bak", raw, 0o600); err != nil {
			return fmt.Errorf("files: write settings.local.json.bak: %w", err)
		}
	}

	if err := mutate(m); err != nil {
		return err
	}

	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return fmt.Errorf("files: marshal settings.local.json: %w", err)
	}
	return atomicWriteLocalSettings(path, data)
}

// resolveLocalSettingsPath returns the confined path to
// {projectRoot}/.claude/settings.local.json. It follows the
// ResolveInstructionPath pattern: canonicalize root, create the parent
// .claude dir if missing, then EvalSymlinks + Confine the PARENT — never the
// leaf, which may not exist on a project's first-ever grant (Confine returns
// a non-existent candidate unchanged, so confining the leaf gives no
// containment).
func resolveLocalSettingsPath(projectRoot string) (string, error) {
	canonRoot, err := filepath.EvalSymlinks(projectRoot)
	if err != nil {
		return "", fmt.Errorf("files: project root %q: %w", projectRoot, err)
	}
	claudeSubdir := filepath.Join(canonRoot, ".claude")
	if err := os.MkdirAll(claudeSubdir, 0o755); err != nil {
		return "", fmt.Errorf("files: create project .claude directory: %w", err)
	}
	parentCanon, err := filepath.EvalSymlinks(claudeSubdir)
	if err != nil {
		return "", fmt.Errorf("files: project .claude directory: %w", err)
	}
	if _, err := Confine(parentCanon, canonRoot); err != nil {
		return "", err
	}
	return filepath.Join(parentCanon, "settings.local.json"), nil
}

// atomicWriteLocalSettings writes settings.local.json via temp+rename at
// 0o600. It intentionally does NOT reuse the package-level atomicWriteFile
// (which stamps 0o644 that os.Rename would adopt) because this file can hold
// env secrets; otherwise it mirrors atomicWriteFile's temp+rename.
func atomicWriteLocalSettings(path string, data []byte) error {
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0o600); err != nil {
		return fmt.Errorf("files: write %s: %w", filepath.Base(tmpPath), err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("files: rename %s: %w", filepath.Base(tmpPath), err)
	}
	return nil
}
