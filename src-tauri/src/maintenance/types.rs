//! Ported from `internal/maintenance/types.go` (W13). Pure DTOs: no path
//! resolution here — roots are resolved by the service layer and injected into
//! `CategorySpec`, matching Go's "matchers stay pure/testable" contract.

use std::collections::BTreeMap;

use chrono::{DateTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};

/// Go's zero `time.Time` marshals to `0001-01-01T00:00:00Z`; reproduce that
/// exact instant so error rows / empty-subtree sentinels serialize identically.
pub(crate) fn go_zero_time() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(1, 1, 1, 0, 0, 0).unwrap()
}

/// Disk usage for one immediate child of a scanned root. Bytes/Files are
/// aggregated recursively from that child's subtree. Mirrors Go `DirUsage`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirUsage {
    pub path: String,
    pub bytes: i64,
    pub files: i64,
    pub mod_time: DateTime<Utc>,
    pub is_symlink: bool,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub err: String,
}

/// A cleanup candidate surfaced by `scan_category`. Describes what could be
/// removed — never removes anything itself. Mirrors Go `Candidate`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub path: String,
    pub bytes: i64,
    pub files: i64,
    pub mod_time: DateTime<Utc>,
    pub reason: String,
    /// Lexically-sortable UI bucket key. Empty = ungrouped (`group,omitempty`).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub group: String,
    /// Category-specific display context. Empty map omitted (`meta,omitempty`);
    /// `BTreeMap` mirrors Go's sorted-key JSON marshaling.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub meta: BTreeMap<String, String>,
}

/// Parameterizes `scan_category` for one leaf category id. The `id` is the unit
/// of both dispatch and cutoff persistence; every other field is injected by the
/// service (`json:"-"` → serde `skip`) so matchers stay pure. Mirrors Go
/// `CategorySpec`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategorySpec {
    pub id: String,
    /// Effective claude root (already validated non-system by the service).
    #[serde(skip)]
    pub root: String,
    /// App-data dir, used only to exclude the app's own trash/manifests.
    #[serde(skip)]
    pub app_data: String,
    /// A candidate must be older than this instant AND not modified today.
    /// `None` = no age gate (Go's zero `time.Time`).
    #[serde(skip)]
    pub cutoff: Option<DateTime<Utc>>,
    /// Anchors the "modified today" live-session guard; injected for test
    /// determinism rather than reading the clock inside matchers.
    #[serde(skip)]
    pub now: DateTime<Utc>,
    /// `enabledPlugins` keys for the plugins cross-reference.
    #[serde(skip)]
    pub enabled: Vec<String>,
    /// Pinned session ids (projects matcher bulk-exclusion cross-reference).
    #[serde(skip)]
    pub pinned: Vec<String>,
    /// Absolute paths of binaries the live settings.json references
    /// (backup-binaries: active binaries are never candidates).
    #[serde(skip)]
    pub active: Vec<String>,
}

impl Default for CategorySpec {
    fn default() -> Self {
        Self {
            id: String::new(),
            root: String::new(),
            app_data: String::new(),
            cutoff: None,
            now: go_zero_time(),
            enabled: Vec::new(),
            pinned: Vec::new(),
            active: Vec::new(),
        }
    }
}
