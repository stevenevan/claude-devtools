//! Ports `internal/maintenance/cleanup_run.go` — composes the per-category
//! cleanups into one retention-policy pass. It adds NO new deletion mechanics:
//! every destructive step is delegated to an INJECTED closure
//! (trash / empty_trash / prune_history) so this module never imports the trash
//! engine or the service layer — the same `run_policy` drives both the dry-run
//! preview and the gated executor. Guards reproduced verbatim (invariant #3).
//!
//! Composition/order: iterate `sorted_policy_ids` (deterministic); skip disabled;
//! DEFENSIVELY skip plain-delete ids (logs/logs-daemon/caches) even if a policy
//! lists one; special-case "history"; else scan the category and trash its paths
//! as one receipt. Cancellable between categories. Trash expiry runs LAST, with
//! its window floored at 1 day (defense-in-depth atop the config clamp).

use std::collections::BTreeMap;

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::config::state::types::{RetentionCategory, RetentionPolicy};
// NOTE: sibling modules (still in flight, owned by other W13 agents). Assumed
// signatures — reconcile if they differ:
//   fn scan_category(spec: &CategorySpec) -> Result<Vec<Candidate>, String>
//   fn cutoff_default(id: &str) -> i64
//   struct CategorySpec { id, root, app_data, cutoff: Option<DateTime<Utc>>,
//                         now: DateTime<Utc>, enabled/pinned/active: Vec<String> }
//   struct Candidate { path: String, bytes: i64, .. }
// CategorySpec is assumed to live in `types` (Go keeps it in types.go); if the
// category agent placed it in `category`, change this import.
use crate::maintenance::category::scan_category;
use crate::maintenance::types::{Candidate, CategorySpec};

/// One policy category's contribution to a Clean-now pass. Mirrors
/// `CategoryReport`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryReport {
    pub id: String,
    pub count: i64,
    pub bytes: i64,
    pub paths: Vec<String>,
}

/// Aggregates every enabled category plus the count of trash receipts the expiry
/// sweep removed (or would remove, in a dry run). Mirrors `CombinedReport`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CombinedReport {
    pub categories: Vec<CategoryReport>,
    pub trash_expiry_count: i64,
}

/// The minimal view of a trash receipt the expiry sweep needs. The `list_trash`
/// closure maps the trash engine's real receipts to these, keeping this module
/// decoupled from `trash.rs` (only trash/empty/list closures cross the boundary,
/// per the injected-closure design). Mirrors the `{ID, TrashedAt}` fields
/// `runTrashExpiry` reads off `TrashReceipt`.
#[derive(Debug, Clone)]
pub struct TrashReceiptView {
    pub id: String,
    pub trashed_at: DateTime<Utc>,
}

/// Injects everything `run_policy` needs from the service layer so this module
/// never imports the service. The destructive closures (trash/empty_trash/
/// prune_history) are the ONLY way this pass mutates disk. Mirrors
/// `RunPolicyOptions`.
pub struct RunPolicyOptions {
    pub root: String,
    pub app_data_dir: String,
    pub policy: RetentionPolicy,
    pub now: DateTime<Utc>,
    pub dry_run: bool,

    /// Resolves a category's age cutoff (days) through the single cutoffs source
    /// so preview == execution.
    pub cutoff_for: Box<dyn Fn(&str) -> i64>,
    /// Populates the id-specific spec fields (enabled/pinned/active) matchers
    /// need. `None` = no enrichment (tests).
    pub enrich: Option<Box<dyn Fn(&str, &mut CategorySpec)>>,

    pub progress: Option<Box<dyn Fn(&str)>>,
    pub trash: Box<dyn Fn(&[String]) -> Result<(), String>>,
    pub empty_trash: Box<dyn Fn(&[String]) -> Result<(), String>>,
    pub list_trash: Box<dyn Fn() -> Result<Vec<TrashReceiptView>, String>>,
    /// Drive the special-cased history.jsonl path — NOT a scan_category matcher.
    pub prune_history: Box<dyn Fn() -> Result<i64, String>>,
    pub analyze_history: Box<dyn Fn() -> Result<i64, String>>,
}

/// The outcome of a `run_policy` pass, mirroring Go's `(report, err)` return
/// where `err == context.Canceled` on a mid-pass cancel. Modeled as the error
/// arm so the partial report is ALWAYS returned alongside.
#[derive(Debug)]
pub enum PolicyError {
    /// A cancel fired between categories — the report holds the partial pass.
    Cancelled,
    /// A real failure (scan/trash/expiry) aborted the pass.
    Failed(String),
}

/// Executes (or, when `dry_run`, previews) one retention pass: every enabled
/// trash-governed category is scanned and its candidates trashed as one receipt,
/// then trash expiry runs LAST. Cancellable between categories — a cancel returns
/// the partial report plus `PolicyError::Cancelled`. Mirrors `RunPolicy`.
pub fn run_policy(
    opts: &RunPolicyOptions,
    cancelled: &dyn Fn() -> bool,
) -> (CombinedReport, Result<(), PolicyError>) {
    let mut report = CombinedReport {
        categories: Vec::new(),
        trash_expiry_count: 0,
    };

    for id in sorted_policy_ids(&opts.policy.categories) {
        if cancelled() {
            return (report, Err(PolicyError::Cancelled));
        }
        if !opts.policy.categories.get(&id).map(|c| c.enabled).unwrap_or(false) {
            continue;
        }
        // Defensive: plain-delete ids must never reach the trash loop even if a
        // hand-edited policy lists one — trashing a log/cache wrongly extends its
        // retention.
        if is_plain_delete_id(&id) {
            continue;
        }
        if let Some(progress) = &opts.progress {
            progress(&id);
        }

        if id == "history" {
            if let Err(e) = run_history_category(&mut report, opts) {
                return (report, Err(PolicyError::Failed(e)));
            }
            continue;
        }

        let cr = match scan_policy_category(&id, opts) {
            Ok(cr) => cr,
            Err(e) => return (report, Err(PolicyError::Failed(e))),
        };
        let paths = cr.paths.clone();
        report.categories.push(cr);
        if !opts.dry_run && !paths.is_empty() {
            if let Err(e) = (opts.trash)(&paths) {
                return (report, Err(PolicyError::Failed(e)));
            }
        }
    }

    if cancelled() {
        return (report, Err(PolicyError::Cancelled));
    }
    match run_trash_expiry(opts) {
        Ok(count) => {
            report.trash_expiry_count = count;
            (report, Ok(()))
        }
        Err(e) => (report, Err(PolicyError::Failed(e))),
    }
}

/// Scans one trash-governed matcher against its cutoff (resolved through the
/// single cutoffs source) and folds the candidates into a per-category report.
/// Mirrors `scanPolicyCategory`.
fn scan_policy_category(id: &str, opts: &RunPolicyOptions) -> Result<CategoryReport, String> {
    let mut cutoff: Option<DateTime<Utc>> = None;
    let days = (opts.cutoff_for)(id);
    if days > 0 {
        cutoff = Some(opts.now - Duration::days(days));
    }
    let mut spec = CategorySpec {
        id: id.to_string(),
        root: opts.root.clone(),
        app_data: opts.app_data_dir.clone(),
        cutoff,
        now: opts.now,
        enabled: Vec::new(),
        pinned: Vec::new(),
        active: Vec::new(),
    };
    if let Some(enrich) = &opts.enrich {
        enrich(id, &mut spec);
    }
    let cands: Vec<Candidate> = scan_category(&spec)?;
    let mut cr = CategoryReport {
        id: id.to_string(),
        count: 0,
        bytes: 0,
        paths: Vec::with_capacity(cands.len()),
    };
    for c in &cands {
        cr.count += 1;
        cr.bytes += c.bytes;
        cr.paths.push(c.path.clone());
    }
    Ok(cr)
}

/// Handles the special-cased history.jsonl path: a dry run counts prunable lines
/// via `analyze_history`; execution prunes (trashing the aged tail) via
/// `prune_history`. Mirrors `runHistoryCategory`.
fn run_history_category(report: &mut CombinedReport, opts: &RunPolicyOptions) -> Result<(), String> {
    let count = if opts.dry_run {
        (opts.analyze_history)()?
    } else {
        (opts.prune_history)()?
    };
    report.categories.push(CategoryReport {
        id: "history".to_string(),
        count,
        bytes: 0,
        paths: Vec::new(),
    });
    Ok(())
}

/// Runs LAST: empties every receipt older than the policy's expiry window. The
/// window is FLOORED at 1 day (defense-in-depth atop the config clamp) so a
/// 0/negative can never purge just-created receipts. A dry run returns the count
/// without emptying. Mirrors `runTrashExpiry`.
fn run_trash_expiry(opts: &RunPolicyOptions) -> Result<i64, String> {
    let receipts = (opts.list_trash)()?;
    let mut expiry_days = opts.policy.trash_expiry_days;
    if expiry_days < 1 {
        expiry_days = 1;
    }
    let cutoff = opts.now - Duration::days(expiry_days);

    let expired: Vec<String> = receipts
        .iter()
        .filter(|r| r.trashed_at < cutoff)
        .map(|r| r.id.clone())
        .collect();
    if expired.is_empty() || opts.dry_run {
        return Ok(expired.len() as i64);
    }
    (opts.empty_trash)(&expired)?;
    Ok(expired.len() as i64)
}

fn sorted_policy_ids(cats: &BTreeMap<String, RetentionCategory>) -> Vec<String> {
    // A BTreeMap already yields keys in sorted order (mirrors sort.Strings).
    cats.keys().cloned().collect()
}

fn is_plain_delete_id(id: &str) -> bool {
    matches!(id, "logs" | "logs-daemon" | "caches")
}

#[cfg(test)]
#[path = "cleanup_run_tests.rs"]
mod cleanup_run_tests;
