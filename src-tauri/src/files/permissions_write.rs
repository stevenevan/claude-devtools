//! Ports `internal/files/permissions_write.go` — the write path for permission
//! rules scattered across global `~/.claude/settings.json` and each project's
//! `.claude/settings.local.json`. It only ever adds/removes ONE opaque rule
//! string in `permissions.{allow,deny,ask}`, preserving every other key — never
//! a full-replace. Global writes route through the single `mutate_settings_json`
//! writer; project-local writes go through `mutate_local_settings` (its own
//! mutex), with the same confine-PARENT-to-root safety as text_write.
//!
//! `settings.local.json` can hold env secrets, so its `.bak` and final write use
//! mode 0o600 (NOT the 0o644 settings.json helper). Guards reproduced verbatim;
//! error sentinels are byte-identical (the frontend matches them literally).

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::fsutil::{lock, write_file_mode};
use super::pathutil::confine;
use super::settings_sources::{
    enumerate_settings_sources, Source, KIND_GLOBAL, KIND_PROJECT_LOCAL,
};
use super::settings_write::mutate_settings_json;

/// One of the three opaque permission-list keys. Mirrors `PermissionList`.
pub type PermissionList = String;

// Permission list keys. Anything else is rejected before any I/O.
pub const PERM_ALLOW: &str = "allow";
pub const PERM_DENY: &str = "deny";
pub const PERM_ASK: &str = "ask";

// Writable scope kinds. Display-only sources (KIND_PROJECT,
// KIND_GLOBAL_NESTED_ANOMALY) must never reach the writer.
pub const SCOPE_GLOBAL: &str = "global";
pub const SCOPE_PROJECT_LOCAL: &str = "project-local";

/// Names a writable settings file. `kind` is "global" (`~/.claude/settings.json`)
/// or "project-local" (`{project_root}/.claude/settings.local.json`);
/// `project_root` is only used for the project-local kind. Mirrors
/// `PermissionScope`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionScope {
    pub kind: String,
    #[serde(default)]
    pub project_root: String,
}

/// One permission rule with its provenance. `writable` is true only for the two
/// editable sources (global + project-local). Mirrors `PermissionRuleRow`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRuleRow {
    pub rule: String,
    pub list: String,
    pub source_kind: String,
    pub source_path: String,
    pub writable: bool,
}

/// The merged rule table for a project. Mirrors `PermissionRulesView`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRulesView {
    pub rows: Vec<PermissionRuleRow>,
}

/// Serializes every settings.local.json write. One lock for the whole family
/// (not a per-path map): read-fresh-under-lock kills the lost-update race, and
/// two different project files never need concurrent human-driven writes.
/// Poison-free acquire via `fsutil::lock`. Mirrors `settingsLocalWriteMu`.
static SETTINGS_LOCAL_WRITE_MU: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

fn validate_permission_list(list: &str) -> Result<(), String> {
    match list {
        PERM_ALLOW | PERM_DENY | PERM_ASK => Ok(()),
        _ => Err(format!(
            "files: invalid permission list {list:?} (want allow|deny|ask)"
        )),
    }
}

fn validate_scope_kind(kind: &str) -> Result<(), String> {
    match kind {
        SCOPE_GLOBAL | SCOPE_PROJECT_LOCAL => Ok(()),
        _ => Err(format!(
            "files: invalid permission scope kind {kind:?} (want global|project-local)"
        )),
    }
}

/// Reuses `enumerate_settings_sources` and extracts only the
/// `permissions.{allow,deny,ask}` arrays from each source — Raw is never
/// exposed. Mirrors `GetPermissionRules`.
pub fn get_permission_rules(project_root: &str) -> Result<PermissionRulesView, String> {
    let view = enumerate_settings_sources(project_root)?;
    let mut rows = Vec::new();
    for src in &view.sources {
        if !src.exists {
            continue;
        }
        rows.extend(permission_rows_from_source(src));
    }
    Ok(PermissionRulesView { rows })
}

/// Parses a single source's raw text and yields its permission rows. Only global
/// + project-local sources are writable. Mirrors `permissionRowsFromSource`.
fn permission_rows_from_source(src: &Source) -> Vec<PermissionRuleRow> {
    let Ok(parsed) = serde_json::from_str::<Value>(&src.raw) else {
        return Vec::new();
    };
    let Some(obj) = parsed.as_object() else {
        return Vec::new();
    };
    let Some(perms) = obj.get("permissions").and_then(Value::as_object) else {
        return Vec::new();
    };
    let writable = src.kind == KIND_GLOBAL || src.kind == KIND_PROJECT_LOCAL;
    let mut rows = Vec::new();
    for list in [PERM_ALLOW, PERM_DENY, PERM_ASK] {
        let Some(arr) = perms.get(list).and_then(Value::as_array) else {
            continue;
        };
        for v in arr {
            let Some(rule) = v.as_str() else {
                continue;
            };
            rows.push(PermissionRuleRow {
                rule: rule.to_string(),
                list: list.to_string(),
                source_kind: src.kind.clone(),
                source_path: src.path.clone(),
                writable,
            });
        }
    }
    rows
}

/// Appends `rule` to `scope`'s `permissions[list]`, preserving all other keys.
/// Rejects a bad list or scope kind before any file I/O. Mirrors
/// `AddPermissionRule`.
pub fn add_permission_rule(scope: PermissionScope, list: &str, rule: &str) -> Result<(), String> {
    validate_permission_list(list)?;
    validate_scope_kind(&scope.kind)?;
    mutate_permissions(&scope, |m| {
        append_rule_to_permissions(m, list, rule);
        Ok(())
    })
}

/// Drops every occurrence equal to `rule` from `scope`'s `permissions[list]`,
/// preserving all other keys. Rejects a bad list or scope kind before any file
/// I/O. Mirrors `RemovePermissionRule`.
pub fn remove_permission_rule(
    scope: PermissionScope,
    list: &str,
    rule: &str,
) -> Result<(), String> {
    validate_permission_list(list)?;
    validate_scope_kind(&scope.kind)?;
    mutate_permissions(&scope, |m| {
        remove_rule_from_permissions(m, list, rule);
        Ok(())
    })
}

/// Adds `rule` to the TARGET first (one atomic write), then removes it from the
/// SOURCE (a second atomic write). A crash between the two leaves a harmless
/// duplicate, never a lost rule. All four inputs are validated up front so a bad
/// source scope can't leave a half-applied add. Mirrors `MovePermissionRule`.
pub fn move_permission_rule(
    from: PermissionScope,
    to: PermissionScope,
    from_list: &str,
    to_list: &str,
    rule: &str,
) -> Result<(), String> {
    validate_permission_list(from_list)?;
    validate_permission_list(to_list)?;
    validate_scope_kind(&from.kind)?;
    validate_scope_kind(&to.kind)?;
    add_permission_rule(to, to_list, rule)?;
    remove_permission_rule(from, from_list, rule)
}

/// Dispatches to the correct writer for `scope.kind`. Callers validate the kind
/// first; the default is a defensive guard. Mirrors `mutatePermissions`.
fn mutate_permissions<F>(scope: &PermissionScope, mutate: F) -> Result<(), String>
where
    F: FnOnce(&mut Map<String, Value>) -> Result<(), String>,
{
    match scope.kind.as_str() {
        SCOPE_GLOBAL => mutate_settings_json(mutate),
        SCOPE_PROJECT_LOCAL => mutate_local_settings(&scope.project_root, mutate),
        other => Err(format!("files: invalid permission scope kind {other:?}")),
    }
}

/// Appends `rule` to `m["permissions"][list]`, creating the permissions map or
/// the list slice if either is missing. Mirrors `appendRuleToPermissions`.
fn append_rule_to_permissions(m: &mut Map<String, Value>, list: &str, rule: &str) {
    let mut perms = match m.get("permissions") {
        Some(Value::Object(o)) => o.clone(),
        _ => Map::new(),
    };
    let mut existing = match perms.get(list) {
        Some(Value::Array(a)) => a.clone(),
        _ => Vec::new(),
    };
    existing.push(Value::String(rule.to_string()));
    perms.insert(list.to_string(), Value::Array(existing));
    m.insert("permissions".to_string(), Value::Object(perms));
}

/// Drops every entry equal to `rule` from `m["permissions"][list]`. A missing
/// permissions map is a silent no-op. Mirrors `removeRuleFromPermissions`.
fn remove_rule_from_permissions(m: &mut Map<String, Value>, list: &str, rule: &str) {
    let mut perms = match m.get("permissions") {
        Some(Value::Object(o)) => o.clone(),
        _ => return,
    };
    let existing = match perms.get(list) {
        Some(Value::Array(a)) => a.clone(),
        _ => Vec::new(),
    };
    let filtered: Vec<Value> = existing
        .into_iter()
        .filter(|v| v.as_str() != Some(rule))
        .collect();
    perms.insert(list.to_string(), Value::Array(filtered));
    m.insert("permissions".to_string(), Value::Object(perms));
}

/// The sole read-modify-atomic-write cycle for a project's settings.local.json,
/// guarded by `SETTINGS_LOCAL_WRITE_MU`. Mirrors `mutate_settings_json`'s
/// read-fresh + .bak + temp-rename idiom, but the parent `{project_root}/.claude`
/// dir is confined to root (never the not-yet-existing leaf), and both the .bak
/// and the final write use 0o600 because settings.local.json can hold env
/// secrets. Mirrors `mutateLocalSettings`.
fn mutate_local_settings<F>(project_root: &str, mutate: F) -> Result<(), String>
where
    F: FnOnce(&mut Map<String, Value>) -> Result<(), String>,
{
    let _guard = lock(&SETTINGS_LOCAL_WRITE_MU);

    let path = resolve_local_settings_path(project_root)?;

    let read_result = fs::read(&path);
    if let Err(e) = &read_result {
        if e.kind() != io::ErrorKind::NotFound {
            return Err(format!("files: read settings.local.json: {e}"));
        }
    }

    let mut m = Map::new();
    if let Ok(raw) = &read_result {
        m = serde_json::from_slice(raw)
            .map_err(|e| format!("files: parse settings.local.json: {e}"))?;
        write_file_mode(&with_suffix(&path, ".bak"), raw, 0o600)
            .map_err(|e| format!("files: write settings.local.json.bak: {e}"))?;
    }

    mutate(&mut m)?;

    let data = crate::files::json_util::to_go_json_pretty(&Value::Object(m))
        .map_err(|e| format!("files: marshal settings.local.json: {e}"))?;
    atomic_write_local_settings(&path, &data)
}

/// Returns the confined path to `{project_root}/.claude/settings.local.json`.
/// Canonicalizes root, creates the parent .claude dir if missing, then confines
/// the PARENT — never the leaf, which may not exist on a project's first-ever
/// grant. Mirrors `resolveLocalSettingsPath`.
fn resolve_local_settings_path(project_root: &str) -> Result<PathBuf, String> {
    let canon_root = fs::canonicalize(project_root)
        .map_err(|e| format!("files: project root {project_root:?}: {e}"))?;
    let claude_subdir = canon_root.join(".claude");
    fs::create_dir_all(&claude_subdir)
        .map_err(|e| format!("files: create project .claude directory: {e}"))?;
    let parent_canon = fs::canonicalize(&claude_subdir)
        .map_err(|e| format!("files: project .claude directory: {e}"))?;
    confine(
        &parent_canon.to_string_lossy(),
        &canon_root.to_string_lossy(),
    )?;
    Ok(parent_canon.join("settings.local.json"))
}

/// Writes settings.local.json via temp+rename at 0o600. Does NOT reuse the
/// 0o644 settings.json helper because this file can hold env secrets. Mirrors
/// `atomicWriteLocalSettings`.
fn atomic_write_local_settings(path: &Path, data: &[u8]) -> Result<(), String> {
    let tmp_path = with_suffix(path, ".tmp");
    let base = base_name(&tmp_path);
    write_file_mode(&tmp_path, data, 0o600).map_err(|e| format!("files: write {base}: {e}"))?;
    if let Err(e) = fs::rename(&tmp_path, path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("files: rename {base}: {e}"));
    }
    Ok(())
}

/// Byte-appends `suffix` to `path` — mirrors Go's `path + ".bak"` / `+ ".tmp"`.
fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut os = path.as_os_str().to_os_string();
    os.push(suffix);
    PathBuf::from(os)
}

/// Mirrors `filepath.Base(path)` for error messages.
fn base_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[cfg(test)]
#[path = "permissions_write_tests.rs"]
mod permissions_write_tests;
