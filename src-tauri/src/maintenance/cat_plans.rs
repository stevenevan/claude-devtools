//! Ported from `internal/maintenance/cat_plans.go` (W13). Lists every plan file
//! under `<root>/plans` as a candidate — nothing is preselected. Staleness (past
//! the cutoff, default 60d) is a Meta badge, NOT a candidacy filter. Variant
//! siblings (shared base name) are grouped; singletons stay ungrouped.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use super::category::{mtime_utc, older_than, open_dir_no_symlink};
use super::types::{Candidate, CategorySpec};

pub fn scan_plans(spec: &CategorySpec) -> Result<Vec<Candidate>, String> {
    let dir = Path::new(&spec.root).join("plans");
    let (entries, ok) = open_dir_no_symlink(&dir)?;
    if !ok {
        return Ok(Vec::new());
    }

    let mut out: Vec<Candidate> = Vec::new();
    for e in &entries {
        if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let Ok(info) = e.metadata() else {
            continue;
        };
        if info.file_type().is_symlink() {
            continue;
        }
        let name = e.file_name().to_string_lossy().into_owned();
        let mtime = mtime_utc(&info);
        let mut meta = BTreeMap::new();
        meta.insert("name".to_string(), name.clone());
        if older_than(mtime, spec) {
            meta.insert("stale".to_string(), "true".to_string());
        }
        out.push(Candidate {
            path: dir.join(&name).to_string_lossy().into_owned(),
            bytes: info.len() as i64,
            files: 1,
            mod_time: mtime,
            reason: "plan document".to_string(),
            group: plan_base_name(&name).to_string(),
            meta,
        });
    }

    // Ungroup singletons: a variant group only helps when siblings exist.
    let mut counts: HashMap<String, usize> = HashMap::new();
    for c in &out {
        *counts.entry(c.group.clone()).or_insert(0) += 1;
    }
    for c in out.iter_mut() {
        if counts.get(&c.group).copied().unwrap_or(0) < 2 {
            c.group = String::new();
        }
    }
    Ok(out)
}

/// Groups a plan with its variant siblings: the filename up to its first dot
/// (index > 0). Mirrors Go `planBaseName`.
fn plan_base_name(name: &str) -> &str {
    match name.find('.') {
        Some(i) if i > 0 => &name[..i],
        _ => name,
    }
}

#[cfg(test)]
#[path = "cat_plans_tests.rs"]
mod cat_plans_tests;
