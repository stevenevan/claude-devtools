//! Read-only browser for `<root>/tasks/{uuid}/{N}.json` background task-graph
//! state. Listing is done in-module via `std::fs::read_dir`, like
//! `claude_read.rs` — `files/` stays a leaf module and never reaches into
//! `maintenance/`. Task dirs are ephemeral background state: an empty/live
//! dir holds only `.highwatermark` + `.lock` (no `{N}.json`) and is skipped;
//! a dir can vanish between calls, so every read error is tolerated, never
//! panics.

use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

use crate::files::claude_read;

/// One task-graph directory's summary. `latest_mtime` is epoch milliseconds
/// of the newest `{N}.json` leaf.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskGraphMeta {
    pub uuid: String,
    pub task_count: usize,
    pub latest_mtime: i64,
    pub label: Option<String>,
}

// confirm-at-impl: each `{N}.json` leaf is assumed to be
// `{id, subject, description, activeForm, status, blocks, blockedBy}` where
// `status` is a free-form string (e.g. "pending") and `blocks`/`blockedBy`
// are arrays of task-id strings.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TaskNode {
    pub id: String,
    pub subject: String,
    pub description: String,
    pub active_form: String,
    pub status: String,
    pub blocks: Vec<String>,
    pub blocked_by: Vec<String>,
}

/// Parses a `{N}.json` leaf filename into its ordering number. Non-matching
/// names (`.highwatermark`, `.lock`, anything else) yield `None`.
fn parse_leaf_number(name: &str) -> Option<u32> {
    name.strip_suffix(".json")?.parse::<u32>().ok()
}

/// Walks `<root>/tasks/`, one entry per uuid dir. A dir with zero `{N}.json`
/// leaves is marker-only (`.highwatermark`/`.lock` from a live/empty
/// session) and is skipped. Tolerant: an unreadable/vanished uuid dir is
/// skipped, never fails the whole listing. Missing `tasks/` returns
/// `Ok(vec![])`.
pub fn list_task_graphs(root: &str) -> Result<Vec<TaskGraphMeta>, String> {
    let dir = Path::new(root).join("tasks");
    let Ok(uuid_entries) = fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };

    let mut out = Vec::new();
    for uuid_entry in uuid_entries.flatten() {
        let uuid = uuid_entry.file_name().to_string_lossy().into_owned();
        if uuid.is_empty() || uuid.starts_with('.') {
            continue;
        }
        let Ok(file_type) = uuid_entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }
        let Ok(leaf_entries) = fs::read_dir(uuid_entry.path()) else {
            continue;
        };

        let mut leaves: Vec<(u32, String)> = Vec::new();
        let mut latest_mtime = 0i64;
        for leaf_entry in leaf_entries.flatten() {
            let leaf_name = leaf_entry.file_name().to_string_lossy().into_owned();
            let Some(leaf_number) = parse_leaf_number(&leaf_name) else {
                continue;
            };
            let Ok(meta) = leaf_entry.metadata() else {
                continue;
            };
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            latest_mtime = latest_mtime.max(mtime);
            leaves.push((leaf_number, leaf_name));
        }

        if leaves.is_empty() {
            continue;
        }
        leaves.sort_by_key(|(number, _)| *number);
        let task_count = leaves.len();
        let label = leaves.first().and_then(|(_, name)| {
            let subdir = format!("tasks/{uuid}");
            let bytes = claude_read::read_confined_file(root, &subdir, name).ok()?;
            let node = serde_json::from_slice::<TaskNode>(&bytes).ok()?;
            let subject = node.subject.trim();
            if !subject.is_empty() {
                return Some(subject.to_string());
            }
            let description = node.description.trim();
            (!description.is_empty()).then(|| description.to_string())
        });
        out.push(TaskGraphMeta {
            uuid,
            task_count,
            latest_mtime,
            label,
        });
    }

    out.sort_by(|a, b| b.latest_mtime.cmp(&a.latest_mtime));
    Ok(out)
}

/// Reads every `{N}.json` leaf under `tasks/{uuid}/`, ordered by `N`
/// ascending, traversal-safe. Each leaf is read through
/// `claude_read::read_confined_file` (root-anchored, parity with the shipped
/// `read_checkpoint`) and parsed tolerantly: a malformed leaf is skipped,
/// siblings are kept. Missing dir returns `Ok(vec![])`.
pub fn read_task_graph(root: &str, uuid: &str) -> Result<Vec<TaskNode>, String> {
    let is_unsafe = |s: &str| s.contains('/') || s.contains('\\') || s.contains("..");
    if is_unsafe(uuid) {
        return Err("files: invalid id".to_string());
    }

    let dir = Path::new(root).join("tasks").join(uuid);
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };

    let mut leaves: Vec<(u32, String)> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(n) = parse_leaf_number(&name) {
            leaves.push((n, name));
        }
    }
    leaves.sort_by_key(|(n, _)| *n);

    let subdir = format!("tasks/{uuid}");
    let nodes = leaves
        .into_iter()
        .filter_map(|(_, name)| {
            let bytes = claude_read::read_confined_file(root, &subdir, &name).ok()?;
            serde_json::from_slice::<TaskNode>(&bytes).ok()
        })
        .collect();

    Ok(nodes)
}

#[cfg(test)]
#[path = "task_graph_reader_tests.rs"]
mod task_graph_reader_tests;
