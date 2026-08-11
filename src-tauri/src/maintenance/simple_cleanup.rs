//! The deliberately small, server-owned cleanup surface used by Simple mode.
//!
//! This module is the policy boundary for the one-click action. Keep the
//! allowlist here, normalize candidates before they reach the trash engine, and
//! expose only aggregate summaries to the renderer.

use std::path::Path;

use serde::Serialize;

use super::cat_junk::{scan_simple_junk, SimpleJunkKind};
use super::category::scan_category;
use super::types::{Candidate, CategorySpec, DirUsage};

pub const TRASH_BATCH_SIZE: usize = 500;

const OLD_FILE_VERSIONS: &str = "old-file-versions";
const LOGS_AND_CACHES: &str = "logs-and-caches";
const EVERYTHING_ELSE: &str = "everything-else";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SimpleCategory {
    pub id: &'static str,
    pub label: &'static str,
    bucket: &'static str,
}

/// The only categories that the Simple-mode action may ever move to trash.
/// Keep this list explicit. In particular, do not replace it with the full
/// retention-policy registry.
pub const SIMPLE_CATEGORIES: &[SimpleCategory] = &[
    SimpleCategory {
        id: "file-history",
        label: "Old file versions",
        bucket: OLD_FILE_VERSIONS,
    },
    SimpleCategory {
        id: "junk-dsstore",
        label: "Everything else",
        bucket: EVERYTHING_ELSE,
    },
    SimpleCategory {
        id: "junk-tmp",
        label: "Everything else",
        bucket: EVERYTHING_ELSE,
    },
    SimpleCategory {
        id: "junk-emptydirs",
        label: "Everything else",
        bucket: EVERYTHING_ELSE,
    },
    SimpleCategory {
        id: "runtime-tasks-empty",
        label: "Everything else",
        bucket: EVERYTHING_ELSE,
    },
    SimpleCategory {
        id: "runtime-jobs",
        label: "Everything else",
        bucket: EVERYTHING_ELSE,
    },
];

const SIMPLE_BUCKETS: &[(&str, &str)] = &[
    (OLD_FILE_VERSIONS, "Old file versions"),
    (LOGS_AND_CACHES, "Logs and caches"),
    (EVERYTHING_ELSE, "Everything else"),
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleCleanupCategorySummary {
    pub id: String,
    pub label: String,
    pub candidates: usize,
    pub bytes: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleCleanupPreview {
    pub token: String,
    pub total_candidates: usize,
    pub total_bytes: i64,
    pub categories: Vec<SimpleCleanupCategorySummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleCleanupReport {
    pub moved_candidates: usize,
    pub moved_bytes: i64,
    pub storage: SimpleStorageSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleStorageBucketSummary {
    pub id: String,
    pub label: String,
    pub bytes: i64,
    pub files: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleStorageSummary {
    pub total_bytes: i64,
    pub total_files: i64,
    pub buckets: Vec<SimpleStorageBucketSummary>,
}

#[derive(Debug, Clone)]
pub struct SimpleCleanupCandidate {
    pub category_id: String,
    pub candidate: Candidate,
}

/// Returns whether an id belongs to the Simple-mode action allowlist.
pub fn is_allowed_category(id: &str) -> bool {
    SIMPLE_CATEGORIES.iter().any(|category| category.id == id)
}

/// Scans the allowlist. The three junk families intentionally share one walk;
/// the caller supplies one spec per allowlisted category so age cutoffs remain
/// explicit and testable.
pub fn scan_allowlist(specs: &[CategorySpec]) -> Result<Vec<SimpleCleanupCandidate>, String> {
    for spec in specs {
        if !is_allowed_category(&spec.id) {
            return Err(format!(
                "maintenance: category {:?} is not allowed in simple cleanup",
                spec.id
            ));
        }
    }

    let junk_spec = specs
        .iter()
        .find(|spec| spec.id == "junk-tmp")
        .ok_or_else(|| "maintenance: simple cleanup missing junk-tmp spec".to_string())?;
    let junk_candidates = scan_simple_junk(junk_spec)
        .map_err(|error| format!("maintenance: simple cleanup scan junk families: {error}"))?;

    let mut out = Vec::new();
    for item in junk_candidates {
        let category_id = match item.kind {
            SimpleJunkKind::DsStore => "junk-dsstore",
            SimpleJunkKind::Tmp => "junk-tmp",
            SimpleJunkKind::EmptyDir => "junk-emptydirs",
        };
        out.push(SimpleCleanupCandidate {
            category_id: category_id.to_string(),
            candidate: item.candidate,
        });
    }

    for spec in specs {
        if spec.id.starts_with("junk-") {
            continue;
        }
        let candidates = scan_category(spec)
            .map_err(|error| format!("maintenance: simple cleanup scan {}: {error}", spec.id))?;
        for candidate in candidates {
            out.push(SimpleCleanupCandidate {
                category_id: spec.id.clone(),
                candidate,
            });
        }
    }

    Ok(normalize_candidates(out))
}

/// Removes duplicate candidates and candidates nested below another candidate.
/// The latter is required because an empty directory can contain a `.DS_Store`
/// candidate; moving the ancestor is one safe trash operation.
pub fn normalize_candidates(
    mut candidates: Vec<SimpleCleanupCandidate>,
) -> Vec<SimpleCleanupCandidate> {
    candidates.sort_by(|a, b| {
        path_depth(&a.candidate.path)
            .cmp(&path_depth(&b.candidate.path))
            .then_with(|| a.candidate.path.cmp(&b.candidate.path))
            .then_with(|| a.category_id.cmp(&b.category_id))
    });

    let mut normalized = Vec::with_capacity(candidates.len());
    for candidate in candidates {
        if normalized.iter().any(|existing: &SimpleCleanupCandidate| {
            existing.candidate.path == candidate.candidate.path
                || Path::new(&candidate.candidate.path)
                    .starts_with(Path::new(&existing.candidate.path))
        }) {
            continue;
        }
        normalized.push(candidate);
    }
    normalized
}

/// Compares the token snapshot with a fresh scan. Paths and filesystem-derived
/// metadata stay backend-only, but all of them participate in the comparison.
pub fn same_snapshot(
    expected: &[SimpleCleanupCandidate],
    actual: &[SimpleCleanupCandidate],
) -> bool {
    if expected.len() != actual.len() {
        return false;
    }
    expected
        .iter()
        .zip(actual)
        .all(|(a, b)| a.category_id == b.category_id && same_candidate(&a.candidate, &b.candidate))
}

fn same_candidate(expected: &Candidate, actual: &Candidate) -> bool {
    expected.path == actual.path
        && expected.bytes == actual.bytes
        && expected.files == actual.files
        && expected.mod_time == actual.mod_time
        && expected.reason == actual.reason
        && expected.group == actual.group
        && expected.meta == actual.meta
}

/// Produces the three label-only summary buckets used by the Simple UI.
pub fn summarize(candidates: &[SimpleCleanupCandidate]) -> Vec<SimpleCleanupCategorySummary> {
    SIMPLE_BUCKETS
        .iter()
        .map(|(id, label)| {
            let mut count = 0usize;
            let mut bytes = 0i64;
            for candidate in candidates {
                let Some(category) = SIMPLE_CATEGORIES
                    .iter()
                    .find(|category| category.id == candidate.category_id)
                else {
                    continue;
                };
                if category.bucket == *id {
                    count += 1;
                    bytes += candidate.candidate.bytes;
                }
            }
            SimpleCleanupCategorySummary {
                id: (*id).to_string(),
                label: (*label).to_string(),
                candidates: count,
                bytes,
            }
        })
        .collect()
}

pub fn total_bytes(candidates: &[SimpleCleanupCandidate]) -> i64 {
    candidates
        .iter()
        .map(|candidate| candidate.candidate.bytes)
        .sum()
}

/// Aggregates the one post-success storage rescan without returning any raw
/// filesystem paths to the renderer.
pub fn summarize_storage(dirs: &[DirUsage]) -> SimpleStorageSummary {
    let mut buckets: Vec<SimpleStorageBucketSummary> = SIMPLE_BUCKETS
        .iter()
        .map(|(id, label)| SimpleStorageBucketSummary {
            id: (*id).to_string(),
            label: (*label).to_string(),
            bytes: 0,
            files: 0,
        })
        .collect();
    for dir in dirs {
        let bucket_id = match Path::new(&dir.path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("")
        {
            "file-history" => OLD_FILE_VERSIONS,
            "logs" | "logs-daemon" | "caches" => LOGS_AND_CACHES,
            _ => EVERYTHING_ELSE,
        };
        let Some(bucket) = buckets.iter_mut().find(|bucket| bucket.id == bucket_id) else {
            continue;
        };
        bucket.bytes += dir.bytes.max(0);
        bucket.files += dir.files.max(0);
    }
    SimpleStorageSummary {
        total_bytes: dirs.iter().map(|dir| dir.bytes.max(0)).sum(),
        total_files: dirs.iter().map(|dir| dir.files.max(0)).sum(),
        buckets,
    }
}

pub fn batch_sizes(candidate_count: usize) -> Vec<usize> {
    (0..candidate_count)
        .step_by(TRASH_BATCH_SIZE)
        .map(|start| (candidate_count - start).min(TRASH_BATCH_SIZE))
        .collect()
}

fn path_depth(path: &str) -> usize {
    Path::new(path).components().count()
}

#[cfg(test)]
#[path = "simple_cleanup_tests.rs"]
mod simple_cleanup_tests;
