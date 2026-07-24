//! Read-only browser for `<root>/plugins/known_marketplaces.json` +
//! per-marketplace `plugins/marketplaces/{name}/.claude-plugin/marketplace.json`
//! manifests. Listing is done in-module via `std::fs::read` — `files/` stays a
//! leaf module and never reaches into `maintenance/`.

use std::collections::HashSet;
use std::path::Path;

use serde::Serialize;

use crate::files::claude_read;

// confirm-at-impl: `known_marketplaces.json` is assumed to be a dict keyed by
// marketplace name, each value `{"source": {"source": "github", "repo": "..."},
// "installLocation": "...", "lastUpdated": "..."}`. Each marketplace's plugin
// listing lives at `plugins/marketplaces/{name}/.claude-plugin/marketplace.json`
// = `{"name", "description", "owner", "plugins": [{"name", "description", ...}]}`.
// `installed_plugins.json` = `{"plugins": {"<pluginName>@<marketplace>": [...]},
// "version": ...}` — a plugin is installed iff that key exists.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogPlugin {
    pub name: String,
    pub description: Option<String>,
    pub installed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceView {
    pub name: String,
    pub source: Option<String>,
    pub last_updated: Option<String>,
    pub plugins: Vec<CatalogPlugin>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceCatalog {
    pub marketplaces: Vec<MarketplaceView>,
}

/// Formats a `known_marketplaces.json` entry's `source` value into a display
/// string: `{"source": "github", "repo": "owner/repo"}` -> `"github:owner/repo"`;
/// a plain string is passed through; anything else falls back to its raw JSON.
fn format_source(source: &serde_json::Value) -> Option<String> {
    if let Some(obj) = source.as_object() {
        if obj.get("source").and_then(|v| v.as_str()) == Some("github") {
            if let Some(repo) = obj.get("repo").and_then(|v| v.as_str()) {
                return Some(format!("github:{repo}"));
            }
        }
    }
    if let Some(s) = source.as_str() {
        return Some(s.to_string());
    }
    serde_json::to_string(source).ok()
}

/// Collects the `"{pluginName}@{marketplace}"` keys of
/// `<root>/plugins/installed_plugins.json`'s `plugins` object. Missing or
/// unreadable file (or an unexpected shape) tolerantly yields an empty set.
fn read_installed_set(root: &str) -> HashSet<String> {
    let Ok(bytes) = std::fs::read(Path::new(root).join("plugins/installed_plugins.json")) else {
        return HashSet::new();
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return HashSet::new();
    };
    value["plugins"]
        .as_object()
        .map(|obj| obj.keys().cloned().collect())
        .unwrap_or_default()
}

/// Reads `<root>/plugins/known_marketplaces.json` and, for each marketplace,
/// its `.claude-plugin/marketplace.json` manifest, cross-referenced against
/// installed plugin keys. Tolerant throughout: a missing/unreadable
/// known-marketplaces file yields an empty catalog; a missing/malformed
/// per-marketplace manifest yields that marketplace with an empty plugin list
/// rather than failing the whole catalog.
pub fn read_marketplace_catalog(root: &str) -> Result<MarketplaceCatalog, String> {
    let Ok(bytes) = std::fs::read(Path::new(root).join("plugins/known_marketplaces.json")) else {
        return Ok(MarketplaceCatalog {
            marketplaces: Vec::new(),
        });
    };
    let Ok(known) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return Ok(MarketplaceCatalog {
            marketplaces: Vec::new(),
        });
    };
    let Some(known_obj) = known.as_object() else {
        return Ok(MarketplaceCatalog {
            marketplaces: Vec::new(),
        });
    };

    let installed = read_installed_set(root);

    let mut marketplaces = Vec::new();
    for (name, meta) in known_obj {
        if name.contains('/') || name.contains('\\') || name.contains("..") {
            continue;
        }

        let source = format_source(&meta["source"]);
        let last_updated = meta["lastUpdated"].as_str().map(str::to_string);

        let plugins = read_marketplace_plugins(root, name, &installed);

        marketplaces.push(MarketplaceView {
            name: name.clone(),
            source,
            last_updated,
            plugins,
        });
    }

    marketplaces.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(MarketplaceCatalog { marketplaces })
}

/// Reads the `plugins` array out of one marketplace's manifest. A missing or
/// unreadable manifest tolerantly yields an empty `Vec` (never fails the
/// whole catalog).
fn read_marketplace_plugins(
    root: &str,
    marketplace_name: &str,
    installed: &HashSet<String>,
) -> Vec<CatalogPlugin> {
    let Ok(bytes) = claude_read::read_confined_file(
        root,
        &format!("plugins/marketplaces/{marketplace_name}/.claude-plugin"),
        "marketplace.json",
    ) else {
        return Vec::new();
    };
    let Ok(manifest) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return Vec::new();
    };
    let Some(entries) = manifest["plugins"].as_array() else {
        return Vec::new();
    };

    entries
        .iter()
        .map(|entry| {
            let plugin_name = entry["name"].as_str().unwrap_or("").to_string();
            let key = format!("{plugin_name}@{marketplace_name}");
            CatalogPlugin {
                description: entry["description"].as_str().map(str::to_string),
                installed: installed.contains(&key),
                name: plugin_name,
            }
        })
        .collect()
}

#[cfg(test)]
#[path = "marketplace_reader_tests.rs"]
mod marketplace_reader_tests;
