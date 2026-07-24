//! Read-only browser for `<root>/history.jsonl` prompt/command history.
//! Paginates via a `before` timestamp cursor rather than a positional
//! offset, because the file is appended live while the inspector is open —
//! see `read_history_page`.

use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// One prompt-history entry. `pasted_count` is the number of keys in the
/// on-disk `pastedContents` object (it is always a `{}`-map, never an array).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub display: String,
    pub project: String,
    pub timestamp: i64,
    pub pasted_count: usize,
}

/// One newest-first cursor page of history entries.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    pub entries: Vec<HistoryEntry>,
    pub total_matched: usize,
    pub has_more: bool,
}

// confirm-at-impl: each `history.jsonl` line is assumed to be
// `{display, pastedContents, project, timestamp}`; unknown/missing fields
// fall back to tolerant defaults rather than dropping the line.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawLine {
    display: Option<String>,
    project: Option<String>,
    timestamp: Option<i64>,
    pasted_contents: Option<Value>,
}

/// Reads `<root>/history.jsonl`, filters/sorts newest-first, and returns one
/// `before`-cursored page. Any read error (missing file included) is
/// tolerant: `Ok` with an empty page, never a hard failure.
///
/// ponytail: timestamp cursor assumes near-unique ms timestamps; two prompts
/// in the same ms at a page boundary could drop one — acceptable for prompt
/// history, switch to a byte-cursor if it bites.
/// ponytail: full-file reparse per call (~8ms/12.9k lines release, measured);
/// fine at release scale — add an mtime+len parsed-Vec cache (append-only ->
/// trivial invalidation) only if it bites.
pub fn read_history_page(
    root: &str,
    before: Option<i64>,
    limit: usize,
    query: Option<&str>,
) -> Result<HistoryPage, String> {
    let path = Path::new(root).join("history.jsonl");
    let Ok(bytes) = std::fs::read(&path) else {
        return Ok(HistoryPage {
            entries: Vec::new(),
            total_matched: 0,
            has_more: false,
        });
    };
    let text = String::from_utf8_lossy(&bytes);

    let query_lower = query.filter(|q| !q.is_empty()).map(|q| q.to_lowercase());

    let mut entries: Vec<HistoryEntry> = text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| serde_json::from_str::<RawLine>(line).ok())
        .map(|raw| {
            let pasted_count = raw
                .pasted_contents
                .as_ref()
                .and_then(|v| v.as_object())
                .map(|o| o.len())
                .unwrap_or(0);
            HistoryEntry {
                display: raw.display.unwrap_or_default(),
                project: raw.project.unwrap_or_default(),
                timestamp: raw.timestamp.unwrap_or(0),
                pasted_count,
            }
        })
        .filter(|entry| match &query_lower {
            None => true,
            Some(q) => {
                entry.display.to_lowercase().contains(q.as_str())
                    || entry.project.to_lowercase().contains(q.as_str())
            }
        })
        .collect();

    entries.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    let total_matched = entries.len();

    let candidates: Vec<HistoryEntry> = match before {
        Some(cutoff) => entries.into_iter().filter(|e| e.timestamp < cutoff).collect(),
        None => entries,
    };
    let has_more = candidates.len() > limit;
    let entries: Vec<HistoryEntry> = candidates.into_iter().take(limit).collect();

    Ok(HistoryPage {
        entries,
        total_matched,
        has_more,
    })
}

#[cfg(test)]
#[path = "history_reader_tests.rs"]
mod history_reader_tests;
