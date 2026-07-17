//! Ports `internal/files/settings_sources.go` — read-only enumeration of every
//! settings source that could affect a project plus a merged, provenance-tracked
//! effective view. `Source.raw` is DELIBERATELY UNMASKED (masking happens
//! client-side at render); NEVER pass a `Source` to a logger — `raw` may hold
//! secrets (env values, tokens).

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::config::root::claude_dir;

// Settings source Kind values.
pub const KIND_GLOBAL: &str = "global";
pub const KIND_GLOBAL_NESTED_ANOMALY: &str = "global-nested-anomaly";
pub const KIND_PROJECT: &str = "project";
pub const KIND_PROJECT_LOCAL: &str = "project-local";

/// One settings.json/settings.local.json location on disk. `raw` is the file's
/// exact text, unmasked. Mirrors `Source`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub path: String,
    pub kind: String,
    pub exists: bool,
    pub is_anomaly: bool,
    pub raw: String,
}

/// The full settings-source enumeration for a project: every source plus a
/// merged, provenance-tracked effective view. Mirrors `SourcesView`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourcesView {
    pub sources: Vec<Source>,
    pub merged: Map<String, Value>,
    pub provenance: HashMap<String, String>,
}

/// Surfaces every settings source that could affect `project_root`: global, a
/// stray nested-global anomaly (a `.claude/` dir INSIDE `~/.claude`), project,
/// and project-local. Read-only; never logs file content. Mirrors
/// `EnumerateSettingsSources`.
pub fn enumerate_settings_sources(project_root: &str) -> Result<SourcesView, String> {
    let cd = claude_dir().map_err(|e| format!("files: enumerate settings sources: {e}"))?;

    let global = read_source(&cd.join("settings.json"), KIND_GLOBAL, false);
    let mut sources = vec![global.clone()];
    sources.extend(nested_anomaly_sources(&cd));

    let project_dir = Path::new(project_root).join(".claude");
    let project = read_source(&project_dir.join("settings.json"), KIND_PROJECT, false);
    let project_local = read_source(
        &project_dir.join("settings.local.json"),
        KIND_PROJECT_LOCAL,
        false,
    );
    sources.push(project.clone());
    sources.push(project_local.clone());

    let (merged, provenance) = merge_sources(&[&global, &project, &project_local]);

    Ok(SourcesView {
        sources,
        merged,
        provenance,
    })
}

/// Surfaces settings.local.json (always, once the nested dir exists) and
/// settings.json (only if present) from a stray `.claude/` directory nested
/// inside the global claudeDir. Mirrors `nestedAnomalySources`.
fn nested_anomaly_sources(cd: &Path) -> Vec<Source> {
    let nested_dir = cd.join(".claude");
    match fs::metadata(&nested_dir) {
        Ok(info) if info.is_dir() => {}
        _ => return Vec::new(),
    }

    let nested_local = read_source(
        &nested_dir.join("settings.local.json"),
        KIND_GLOBAL_NESTED_ANOMALY,
        true,
    );
    let mut out = vec![nested_local];
    let nested_global = read_source(
        &nested_dir.join("settings.json"),
        KIND_GLOBAL_NESTED_ANOMALY,
        true,
    );
    if nested_global.exists {
        out.push(nested_global);
    }
    out
}

/// Reads `path`'s exact text. A missing file (or any read error) is
/// `exists: false` with empty `raw` — one unreadable source must never fail the
/// whole enumeration. Mirrors `readSource`.
fn read_source(path: &Path, kind: &str, is_anomaly: bool) -> Source {
    let path_str = path.to_string_lossy().into_owned();
    match fs::read(path) {
        Ok(raw) => Source {
            path: path_str,
            kind: kind.to_string(),
            exists: true,
            is_anomaly,
            raw: String::from_utf8_lossy(&raw).into_owned(),
        },
        Err(_) => Source {
            path: path_str,
            kind: kind.to_string(),
            exists: false,
            is_anomaly,
            raw: String::new(),
        },
    }
}

/// Shallow-merges top-level keys from `sources` in precedence order (later
/// wins), recording per-key provenance. The nested global anomaly is
/// deliberately excluded here. A source that is missing or fails to parse as a
/// JSON object is skipped for merge purposes only; it still appears in
/// `SourcesView.sources` with its `raw` intact. Mirrors `mergeSources`.
fn merge_sources(sources: &[&Source]) -> (Map<String, Value>, HashMap<String, String>) {
    let mut merged = Map::new();
    let mut provenance = HashMap::new();
    for s in sources {
        if !s.exists {
            continue;
        }
        let Ok(parsed) = serde_json::from_str::<Map<String, Value>>(&s.raw) else {
            continue;
        };
        for (k, v) in parsed {
            merged.insert(k.clone(), v);
            provenance.insert(k, s.path.clone());
        }
    }
    (merged, provenance)
}

#[cfg(test)]
#[path = "settings_sources_tests.rs"]
mod settings_sources_tests;
