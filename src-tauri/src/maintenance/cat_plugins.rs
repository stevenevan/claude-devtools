//! Ported from `internal/maintenance/cat_plugins.go` (W13). Surfaces reclaimable
//! plugin storage under `<root>/plugins`: per-plugin `cache/` (enabled
//! cross-referenced), `marketplaces/`, and `repos/`. No age gate — plugin cache
//! is regenerable; staleness is decided by enabled-state.

use std::collections::{BTreeMap, HashSet};
use std::path::Path;

use super::category::{bool_str, open_dir_no_symlink, subtree_stats};
use super::types::{Candidate, CategorySpec};

pub fn scan_plugins(spec: &CategorySpec) -> Result<Vec<Candidate>, String> {
    let plugins_dir = Path::new(&spec.root).join("plugins");
    let enabled: HashSet<&str> = spec.enabled.iter().map(String::as_str).collect();

    let mut out: Vec<Candidate> = Vec::new();

    let cache = scan_plugin_cache(&plugins_dir.join("cache"), &enabled)?;
    let cache_len = cache.len();
    out.extend(cache);

    let markets =
        scan_plugin_children(&plugins_dir.join("marketplaces"), "marketplaces", "marketplace metadata")?;
    out.extend(markets);

    let repos = scan_plugin_children(&plugins_dir.join("repos"), "repos", "cached repo")?;
    let repos_len = repos.len();
    out.extend(repos);

    // Anomaly: repos/ empty while cache/ holds data. Surface it as an
    // informational flag on the cache candidates — never auto-delete on it.
    if repos_len == 0 && cache_len > 0 {
        let (repos_entries, ok) = open_dir_no_symlink(&plugins_dir.join("repos"))?;
        if ok && repos_entries.is_empty() {
            for c in out.iter_mut() {
                if c.group == "cache" {
                    c.meta.insert("layoutAnomaly".to_string(), "repos-empty".to_string());
                }
            }
        }
    }

    Ok(out)
}

/// Walks `cache/<marketplace>/<plugin>`, one candidate per plugin. Mirrors Go
/// `scanPluginCache`.
fn scan_plugin_cache(cache_dir: &Path, enabled: &HashSet<&str>) -> Result<Vec<Candidate>, String> {
    let (markets, ok) = open_dir_no_symlink(cache_dir)?;
    if !ok {
        return Ok(Vec::new());
    }

    let mut out: Vec<Candidate> = Vec::new();
    for market in &markets {
        if !market.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let market_name = market.file_name().to_string_lossy().into_owned();
        let market_dir = cache_dir.join(&market_name);
        let (plugins, ok) = open_dir_no_symlink(&market_dir)?;
        if !ok {
            continue;
        }
        for plugin in &plugins {
            if !plugin.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let plugin_name = plugin.file_name().to_string_lossy().into_owned();
            let plugin_dir = market_dir.join(&plugin_name);
            let (bytes, files, newest) = subtree_stats(&plugin_dir);
            let is_enabled = enabled.contains(format!("{plugin_name}@{market_name}").as_str())
                || enabled.contains(plugin_name.as_str());
            let reason = if is_enabled {
                "cached data for an enabled plugin — safe to remove but forces a re-download on next use"
            } else {
                "cached data for a disabled or uninstalled plugin"
            };
            let mut meta = BTreeMap::new();
            meta.insert("marketplace".to_string(), market_name.clone());
            meta.insert("plugin".to_string(), plugin_name.clone());
            meta.insert("enabled".to_string(), bool_str(is_enabled).to_string());
            out.push(Candidate {
                path: plugin_dir.to_string_lossy().into_owned(),
                bytes,
                files,
                mod_time: newest,
                reason: reason.to_string(),
                group: "cache".to_string(),
                meta,
            });
        }
    }
    Ok(out)
}

/// Emits one candidate per immediate child dir of `dir`. Mirrors Go
/// `scanPluginChildren`.
fn scan_plugin_children(dir: &Path, group: &str, reason: &str) -> Result<Vec<Candidate>, String> {
    let (entries, ok) = open_dir_no_symlink(dir)?;
    if !ok {
        return Ok(Vec::new());
    }

    let mut out: Vec<Candidate> = Vec::new();
    for e in &entries {
        if !e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = e.file_name().to_string_lossy().into_owned();
        let child = dir.join(&name);
        let (bytes, files, newest) = subtree_stats(&child);
        let mut meta = BTreeMap::new();
        meta.insert("name".to_string(), name);
        out.push(Candidate {
            path: child.to_string_lossy().into_owned(),
            bytes,
            files,
            mod_time: newest,
            reason: reason.to_string(),
            group: group.to_string(),
            meta,
        });
    }
    Ok(out)
}

#[cfg(test)]
#[path = "cat_plugins_tests.rs"]
mod cat_plugins_tests;
