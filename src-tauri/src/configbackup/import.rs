//! Ports `internal/configbackup/import.go` (W14) — the config import TRUST GATE.
//! An imported archive can carry hooks + permission rules = arbitrary command
//! execution on the next CLI run, so every step is fail-closed: entry-count cap,
//! zip-slip name validation, allowlist gate, per-entry + running total byte caps
//! (limited reader), typed shape + strict manifest schema. `apply_import` never
//! writes an imported hook into settings.json — it deletes the `hooks` block and
//! routes the groups to the app-owned, CLI-ignored hooks-disabled.json, DISABLED
//! — and drops any redaction-placeholder value. Guards reproduced verbatim
//! (invariant #3).

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, File};
use std::io::Read;
use std::path::Path;

use serde::Deserialize;
use serde_json::{Map, Value};

use super::restore::{confine_import_dest, write_file_with_bak};
use crate::configbackup::capture::capture_config;
use crate::configbackup::types::{
    category_for_rel, match_config_allowlist, ImportPreview, REDACTION_PLACEHOLDER,
};
use crate::files::agents_write::clean;
use crate::files::hooks_write::add_disabled_hook_groups;
use crate::files::json_util::to_go_json_pretty;
use crate::files::settings_write::replace_settings_json;

// Zip-bomb / fail-closed caps for an untrusted import archive.
const MAX_IMPORT_ENTRIES: usize = 2000;
const MAX_ENTRY_BYTES: u64 = 8 << 20; // 8 MiB per decompressed entry
const MAX_TOTAL_IMPORT_BYTES: u64 = 64 << 20; // 64 MiB total decompressed

/// Opens the archive and, with ZERO disk writes, fail-closed validates it,
/// returning the review preview enumerating the imported hooks + permission
/// rules. Mirrors `ValidateImport`.
pub fn validate_import(archive_path: &Path) -> Result<ImportPreview, String> {
    let (entries, manifest) = read_validated_archive(archive_path)?;

    let mut preview = ImportPreview {
        secrets_included: manifest.secrets_included,
        archive_path: archive_path.to_string_lossy().into_owned(),
        hook_commands: Vec::new(),
        permission_rules: Vec::new(),
        categories: distinct_categories(&entries),
    };
    if let Some(settings) = entries.get("settings.json") {
        preview.hook_commands = extract_hook_commands(settings);
        preview.permission_rules = extract_permission_rules(settings);
    }
    Ok(preview)
}

/// Applies the confirmed categories of the archive. Mirrors `ApplyImport`.
pub fn apply_import(
    root: &Path,
    app_data_dir: &Path,
    archive_path: &Path,
    confirmed_categories: &[String],
) -> Result<(), String> {
    capture_config(root, app_data_dir, "pre-import", true)
        .map_err(|e| format!("configbackup: pre-import snapshot: {e}"))?;

    let (entries, _) = read_validated_archive(archive_path)?;

    let confirmed: HashSet<String> = confirmed_categories.iter().cloned().collect();

    let canon_root = fs::canonicalize(root)
        .map_err(|e| format!("configbackup: resolve root {}: {e}", root.display()))?;

    if confirmed.contains("settings") {
        if let Some(settings_bytes) = entries.get("settings.json") {
            let (hooks_groups, stripped) = strip_hooks_from_settings(settings_bytes)?;
            replace_settings_json(&stripped)
                .map_err(|e| format!("configbackup: apply settings.json: {e}"))?;
            let app_data_str = app_data_dir.to_string_lossy();
            add_disabled_hook_groups(&app_data_str, &hooks_groups)
                .map_err(|e| format!("configbackup: stash imported hooks disabled: {e}"))?;
        }
    }

    for (rel, data) in &entries {
        if clean(rel) == "settings.json" {
            continue; // handled above (hooks-stripped)
        }
        if !confirmed.contains(category_for_rel(rel)) {
            continue;
        }
        let dest = confine_import_dest(&canon_root, rel)?;
        write_file_with_bak(&dest, data)
            .map_err(|e| format!("configbackup: apply {:?}: {e}", rel))?;
    }
    Ok(())
}

/// The sorted set of non-empty categories the archive's allowlisted entries
/// belong to. Mirrors `distinctCategories`.
fn distinct_categories(entries: &BTreeMap<String, Vec<u8>>) -> Vec<String> {
    let mut seen: HashSet<String> = HashSet::new();
    for rel in entries.keys() {
        let cat = category_for_rel(rel);
        if !cat.is_empty() {
            seen.insert(cat.to_string());
        }
    }
    let mut out: Vec<String> = seen.into_iter().collect();
    out.sort();
    out
}

/// The shared fail-closed reader for `validate_import` and `apply_import`. Never
/// writes to disk. Returns the allowlisted, size-capped, shape-validated entries
/// (root-relative key => bytes) plus the schema-validated manifest, or an error
/// on the FIRST violation. Mirrors `readValidatedArchive`.
fn read_validated_archive(
    archive_path: &Path,
) -> Result<(BTreeMap<String, Vec<u8>>, ManifestSchema), String> {
    let file =
        File::open(archive_path).map_err(|e| format!("configbackup: open archive: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("configbackup: open archive: {e}"))?;

    if archive.len() > MAX_IMPORT_ENTRIES {
        return Err(format!(
            "configbackup: archive has too many entries ({} > {})",
            archive.len(),
            MAX_IMPORT_ENTRIES
        ));
    }

    let mut entries: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    let mut manifest_bytes: Option<Vec<u8>> = None;
    let mut total: u64 = 0;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("configbackup: read archive: {e}"))?;
        let name = entry.name().to_string();
        validate_archive_entry_name(&name)?;
        if name.ends_with('/') {
            continue; // directory entry — no content
        }
        let is_manifest = name == "manifest.json";
        if !is_manifest && !match_config_allowlist(&name) {
            return Err(format!(
                "configbackup: archive entry {:?} is not in the allowlist",
                name
            ));
        }

        let data = read_zip_entry_limited(&mut entry, &name)?;
        total += data.len() as u64;
        if total > MAX_TOTAL_IMPORT_BYTES {
            return Err("configbackup: archive exceeds the total size cap".to_string());
        }

        if is_manifest {
            manifest_bytes = Some(data);
            continue;
        }
        validate_entry_shape(&name, &data)?;
        entries.insert(name, data);
    }

    let manifest_bytes = manifest_bytes
        .ok_or_else(|| "configbackup: archive has no manifest.json".to_string())?;
    let manifest = validate_manifest_schema(&manifest_bytes)?;
    Ok((entries, manifest))
}

/// Rejects absolute names and any `/`- or `\`-delimited `..` segment (zip-slip),
/// before the name is ever trusted. Mirrors `validateArchiveEntryName`.
fn validate_archive_entry_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("configbackup: empty archive entry name".to_string());
    }
    if name.starts_with('/') || Path::new(name).is_absolute() {
        return Err(format!("configbackup: archive entry {:?} is absolute", name));
    }
    for seg in name.split(|c| c == '/' || c == '\\') {
        if seg == ".." {
            return Err(format!(
                "configbackup: archive entry {:?} contains a parent traversal",
                name
            ));
        }
    }
    Ok(())
}

/// Reads one entry through a LIMITED reader, rejecting a decompressed size over
/// the per-entry cap (zip bomb). Mirrors `readZipEntryLimited`.
fn read_zip_entry_limited<R: Read>(reader: R, name: &str) -> Result<Vec<u8>, String> {
    let mut data = Vec::new();
    reader
        .take(MAX_ENTRY_BYTES + 1)
        .read_to_end(&mut data)
        .map_err(|e| format!("configbackup: read archive entry {:?}: {e}", name))?;
    if data.len() as u64 > MAX_ENTRY_BYTES {
        return Err(format!(
            "configbackup: archive entry {:?} exceeds the per-entry size cap",
            name
        ));
    }
    Ok(data)
}

/// Typed-checks one file's expected shape: settings.json must be a JSON object,
/// any `.json` must be valid JSON, everything else must be valid UTF-8 text.
/// Mirrors `validateEntryShape`.
fn validate_entry_shape(name: &str, data: &[u8]) -> Result<(), String> {
    if name == "settings.json" {
        serde_json::from_slice::<Map<String, Value>>(data)
            .map_err(|e| format!("configbackup: settings.json is not a JSON object: {e}"))?;
        return Ok(());
    }
    if name.ends_with(".json") {
        if serde_json::from_slice::<Value>(data).is_err() {
            return Err(format!("configbackup: entry {:?} is not valid JSON", name));
        }
        return Ok(());
    }
    if std::str::from_utf8(data).is_err() {
        return Err(format!(
            "configbackup: entry {:?} is not valid UTF-8 text",
            name
        ));
    }
    Ok(())
}

/// Strict manifest shadow of the shared `Manifest`, with `deny_unknown_fields`
/// (mirrors Go's `dec.DisallowUnknownFields()`) and container `default` (Go's
/// decoder leaves absent fields zero-valued, never rejecting on a missing one).
/// Kept local so the store's lenient read of the shared `Manifest` is unaffected.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
#[allow(dead_code)]
struct ManifestSchema {
    id: String,
    label: String,
    created_ms: f64,
    secrets_included: bool,
    // Go marshals a nil slice as `null`; `#[serde(default)]` alone rejects an
    // explicit `null`. Tolerate array | null | absent, matching Go's decoder and
    // the sibling `Manifest` (parity: a Go-exported manifest must import here).
    #[serde(deserialize_with = "crate::configbackup::types::vec_or_null")]
    files: Vec<FileEntrySchema>,
    #[serde(deserialize_with = "crate::configbackup::types::vec_or_null")]
    skill_links: Vec<SkillLinkSchema>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
#[allow(dead_code)]
struct FileEntrySchema {
    rel_path: String,
    size: i64,
    sha256: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
#[allow(dead_code)]
struct SkillLinkSchema {
    name: String,
    target: String,
}

/// Strictly decodes the manifest, rejecting any unknown / extra field, and
/// requires a non-empty id. Mirrors `validateManifestSchema`.
fn validate_manifest_schema(data: &[u8]) -> Result<ManifestSchema, String> {
    let manifest: ManifestSchema = serde_json::from_slice(data)
        .map_err(|e| format!("configbackup: invalid manifest schema: {e}"))?;
    if manifest.id.is_empty() {
        return Err("configbackup: manifest is missing an id".to_string());
    }
    Ok(manifest)
}

/// Parses the imported settings.json, extracts and removes its `hooks` block,
/// drops any value equal to the redaction placeholder, and returns (the
/// extracted groups, the hooks-stripped marshaled bytes). Mirrors
/// `stripHooksFromSettings`.
fn strip_hooks_from_settings(
    settings_bytes: &[u8],
) -> Result<(HashMap<String, Vec<Value>>, Vec<u8>), String> {
    let mut m: Map<String, Value> = serde_json::from_slice(settings_bytes)
        .map_err(|e| format!("configbackup: parse imported settings.json: {e}"))?;
    let groups = extract_hook_groups(m.get("hooks"));
    m.remove("hooks");
    let mut root = Value::Object(m);
    drop_placeholder_values(&mut root);
    let out = to_go_json_pretty(&root)
        .map_err(|e| format!("configbackup: marshal hooks-stripped settings: {e}"))?;
    Ok((groups, out))
}

/// Converts a settings `hooks` value (event -> []group) into the event->groups
/// map `add_disabled_hook_groups` consumes, keeping only non-empty group slices.
/// Mirrors `extractHookGroups`.
fn extract_hook_groups(hooks_val: Option<&Value>) -> HashMap<String, Vec<Value>> {
    let mut out: HashMap<String, Vec<Value>> = HashMap::new();
    let Some(Value::Object(hooks)) = hooks_val else {
        return out;
    };
    for (event, v) in hooks {
        if let Value::Array(groups) = v {
            if !groups.is_empty() {
                out.insert(event.clone(), groups.clone());
            }
        }
    }
    out
}

/// Recursively deletes any object key whose string value equals the redaction
/// placeholder (never write a masked marker live). Mirrors
/// `dropPlaceholderValues`.
fn drop_placeholder_values(v: &mut Value) {
    match v {
        Value::Object(map) => {
            let to_remove: Vec<String> = map
                .iter()
                .filter(|(_, val)| val.as_str() == Some(REDACTION_PLACEHOLDER))
                .map(|(k, _)| k.clone())
                .collect();
            for k in to_remove {
                map.remove(&k);
            }
            for (_, val) in map.iter_mut() {
                drop_placeholder_values(val);
            }
        }
        Value::Array(arr) => {
            for e in arr.iter_mut() {
                drop_placeholder_values(e);
            }
        }
        _ => {}
    }
}

/// Enumerates every `command` string under settings `hooks`. Mirrors
/// `extractHookCommands`.
fn extract_hook_commands(settings_bytes: &[u8]) -> Vec<String> {
    let Ok(m) = serde_json::from_slice::<Map<String, Value>>(settings_bytes) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    collect_hook_commands(m.get("hooks"), &mut out);
    out
}

fn collect_hook_commands(v: Option<&Value>, out: &mut Vec<String>) {
    match v {
        Some(Value::Object(map)) => {
            for (k, val) in map {
                if k == "command" {
                    if let Some(s) = val.as_str() {
                        out.push(s.to_string());
                    }
                }
                collect_hook_commands(Some(val), out);
            }
        }
        Some(Value::Array(arr)) => {
            for e in arr {
                collect_hook_commands(Some(e), out);
            }
        }
        _ => {}
    }
}

/// Enumerates every `permissions.{allow,deny,ask}` rule. Mirrors
/// `extractPermissionRules`.
fn extract_permission_rules(settings_bytes: &[u8]) -> Vec<String> {
    let Ok(m) = serde_json::from_slice::<Map<String, Value>>(settings_bytes) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let perms = m.get("permissions").and_then(Value::as_object);
    for list in ["allow", "deny", "ask"] {
        let Some(arr) = perms.and_then(|p| p.get(list)).and_then(Value::as_array) else {
            continue;
        };
        for r in arr {
            if let Some(s) = r.as_str() {
                out.push(s.to_string());
            }
        }
    }
    out
}

#[cfg(test)]
#[path = "import_tests.rs"]
mod import_tests;
