//! Ports `internal/files/plugins_write.go` — the `enabledPlugins` map editor in
//! `~/.claude/settings.json` plus pure duplicate detection. Every write routes
//! through `settings_write::mutate_settings_json` (read-fresh-under-lock, `.bak`
//! backup, atomic temp+rename), so this module holds NO lock of its own and
//! never touches anything under `plugins/`. Guards reproduced verbatim.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::settings_write::mutate_settings_json;

/// One entry in the installed-plugins result. Mirrors Go's `Plugin` (defined in
/// `pathutil.go`, carried here for the duplicate DTO / test surface).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plugin {
    pub id: String,
    pub name: String,
    pub marketplace: String,
    pub version: String,
    pub installed_at: String,
    pub last_updated: String,
    pub enabled: bool,
}

/// One plugin Name enabled under 2+ distinct marketplaces at once — the CLI has
/// no defined precedence for this, so the UI surfaces it. Mirrors
/// `DuplicateGroup`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    pub name: String,
    pub entries: Vec<Plugin>,
}

/// Reads `~/.claude/plugins/installed_plugins.json`, cross-referencing the
/// `enabledPlugins` map in settings.json. Missing file → empty list. Mirrors
/// `pathutil.go:ReadGlobalPlugins` (claudeDir-hardcoded, sorted by Name).
pub fn read_global_plugins() -> Result<Vec<Plugin>, String> {
    let cd = crate::config::root::claude_dir()?;
    let plugins_file = cd.join("plugins").join("installed_plugins.json");
    if !plugins_file.exists() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read(&plugins_file).map_err(|e| e.to_string())?;
    let data: Map<String, Value> = serde_json::from_slice(&raw).map_err(|e| e.to_string())?;

    // enabledPlugins from settings.json (best-effort).
    let mut enabled: HashSet<String> = HashSet::new();
    if let Ok(raw2) = std::fs::read(cd.join("settings.json")) {
        if let Ok(settings) = serde_json::from_slice::<Map<String, Value>>(&raw2) {
            if let Some(Value::Object(ep)) = settings.get("enabledPlugins") {
                for (k, v) in ep {
                    if v.as_bool() == Some(true) {
                        enabled.insert(k.clone());
                    }
                }
            }
        }
    }

    let mut out: Vec<Plugin> = Vec::new();
    if let Some(Value::Object(plugins)) = data.get("plugins") {
        let mut keys: Vec<&String> = plugins.keys().collect();
        keys.sort();
        for key in keys {
            let Some(Value::Array(entries)) = plugins.get(key) else {
                continue;
            };
            let Some(Value::Object(entry)) = entries.first() else {
                continue;
            };
            let (name, marketplace) = match key.find('@') {
                Some(at) => (key[..at].to_string(), key[at + 1..].to_string()),
                None => (key.clone(), String::new()),
            };
            let is_enabled = enabled.contains(key) || enabled.contains(&name);
            out.push(Plugin {
                id: key.clone(),
                name,
                marketplace,
                version: str_field(entry, "version"),
                installed_at: str_field(entry, "installedAt"),
                last_updated: str_field(entry, "lastUpdated"),
                enabled: is_enabled,
            });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

fn str_field(m: &Map<String, Value>, key: &str) -> String {
    m.get(key).and_then(|v| v.as_str()).unwrap_or("").to_string()
}

/// Groups plugins by Name and flags any group with 2+ entries Enabled under
/// distinct Marketplace values. Pure — no IO, operates on the already-read
/// output of `read_global_plugins`. Groups sorted by Name, each group's Entries
/// sorted by Marketplace, for deterministic output. Mirrors
/// `DetectPluginDuplicates`.
pub fn detect_plugin_duplicates(plugins: &[Plugin]) -> Vec<DuplicateGroup> {
    let mut by_name: HashMap<String, Vec<Plugin>> = HashMap::new();
    for p in plugins {
        by_name.entry(p.name.clone()).or_default().push(p.clone());
    }

    let mut groups: Vec<DuplicateGroup> = Vec::new();
    for (name, entries) in by_name {
        let mut enabled_entries: Vec<Plugin> = Vec::new();
        let mut marketplaces: HashSet<String> = HashSet::new();
        for e in entries {
            if !e.enabled {
                continue;
            }
            marketplaces.insert(e.marketplace.clone());
            enabled_entries.push(e);
        }
        if marketplaces.len() < 2 {
            continue;
        }
        enabled_entries.sort_by(|a, b| a.marketplace.cmp(&b.marketplace));
        groups.push(DuplicateGroup {
            name,
            entries: enabled_entries,
        });
    }

    groups.sort_by(|a, b| a.name.cmp(&b.name));
    groups
}

/// Adds or removes `key` (a "plugin@marketplace" id, or occasionally a bare
/// plugin name) in settings.json's "enabledPlugins" map, preserving every other
/// key and entry. Touches nothing under `plugins/`. Mirrors `SetPluginEnabled`.
pub fn set_plugin_enabled(key: &str, enable: bool) -> Result<(), String> {
    mutate_settings_json(|m| {
        let mut enabled = enabled_plugins_map(m);
        if enable {
            enabled.insert(key.to_string(), Value::Bool(true));
        } else {
            enabled.remove(key);
        }
        m.insert("enabledPlugins".to_string(), Value::Object(enabled));
        Ok(())
    })
}

/// Removes every "enabledPlugins" key whose plugin-name part equals `name`,
/// except `keep_key`. Also removes a bare "<name>" key (no "@marketplace"
/// suffix). The caller chooses `keep_key` — this never auto-picks a survivor.
/// Mirrors `DedupePlugin`.
pub fn dedupe_plugin(name: &str, keep_key: &str) -> Result<(), String> {
    mutate_settings_json(|m| {
        let mut enabled = enabled_plugins_map(m);
        let to_remove: Vec<String> = enabled
            .keys()
            .filter(|key| {
                let key = key.as_str();
                key != keep_key && plugin_name_part(key) == name
            })
            .cloned()
            .collect();
        for key in to_remove {
            enabled.remove(&key);
        }
        m.insert("enabledPlugins".to_string(), Value::Object(enabled));
        Ok(())
    })
}

/// Reads `m["enabledPlugins"]` as a map, returning an empty one if absent or of
/// the wrong type. Existing entries and their value types (some are legacy
/// non-bool) are preserved as-is. Mirrors `enabledPluginsMap`.
fn enabled_plugins_map(m: &Map<String, Value>) -> Map<String, Value> {
    match m.get("enabledPlugins") {
        Some(Value::Object(existing)) => existing.clone(),
        _ => Map::new(),
    }
}

/// Returns the substring of `key` before "@", or `key` unchanged if it has no
/// "@". Mirrors `pluginNamePart` (the id-splitting in `read_global_plugins`).
fn plugin_name_part(key: &str) -> &str {
    match key.find('@') {
        Some(at) => &key[..at],
        None => key,
    }
}

#[cfg(test)]
#[path = "plugins_write_tests.rs"]
mod plugins_write_tests;
