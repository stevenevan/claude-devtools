//! Ports `internal/files/claudejson.go` — the read-only X-ray of `~/.claude.json`
//! and the MASKING PRIMITIVES shared by the write half + config export. This is
//! the CLI's most credential-dense state file: EVERY value that leaves this
//! module is masked key-OR-value (census carries key name + kind + size ONLY;
//! per-value reveal re-applies masking). Values are NEVER logged. Masking shapes
//! (`CLAUDE_JSON_MASK`, `SECRET_KEY_PATTERN`, `SECRET_VALUE_PATTERN`) match the
//! Go source and the client-side redactor byte-for-byte.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::{Duration, SystemTime};

use chrono::{DateTime, Utc};
use regex::{Regex, RegexBuilder};
use serde::de::IgnoredAny;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::config::root::{claude_dir, projects_dir};
use crate::discovery::path_decoder::decode_path;

use super::pathutil::confine;

/// Placeholder rendered in place of any secret-shaped key or value. Matches the
/// client-side redactor mask (U+2022 ×4) so the two layers look identical.
pub(super) const CLAUDE_JSON_MASK: &str = "\u{2022}\u{2022}\u{2022}\u{2022}";

/// Single short pause before the one retry read (mid-rewrite race, not damage).
const CLAUDE_JSON_RETRY_DELAY: Duration = Duration::from_millis(40);

/// Go port of `secretKeyPattern` (envSecretMatcher's SECRET_KEY_PATTERN extended
/// with claude.json credential blobs). `(?i)` → `case_insensitive`. Fails open:
/// an unmatched key stays plaintext, so the pattern is deliberately broad.
pub(super) static SECRET_KEY_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    RegexBuilder::new(
        r"PASSWORD|PASSWD|SECRET|CREDENTIAL|PRIVATE_KEY|PASSPHRASE|TOKEN|_KEY$|_PAT$|AUTH|API_KEY|API.?KEY|ACCESS.?KEY|SECRET.?KEY|PRIVATE.?KEY|OAUTH|BEARER|EMAIL|ACCOUNT",
    )
    .case_insensitive(true)
    .build()
    .unwrap()
});

/// Go port of `secretValuePattern` (redactSecrets' SECRET_VALUE_PATTERN): value
/// shapes that look like secrets regardless of key name. Case-sensitive.
pub(super) static SECRET_VALUE_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(sk-|ghp_|gho_|github_pat_|AKIA|xox[baprs]-|eyJ[A-Za-z0-9_-]+\.|Bearer )").unwrap()
});

/// Matches the CLI's own rolling backup filenames (e.g.
/// `.claude.json.backup.1783695046813`). Read validation requires this shape so
/// `read_claude_json_backup` can never be turned into an arbitrary-file read.
static CLAUDE_JSON_BACKUP_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[A-Za-z0-9._-]*\.claude\.json\.backup\.[A-Za-z0-9_-]+$").unwrap()
});

// Triage states for project entries.
const TRIAGE_LIVE: &str = "live";
pub(super) const TRIAGE_STALE: &str = "stale";
const TRIAGE_UNVERIFIABLE: &str = "unverifiable";

/// One top-level (or flag) key in the census: name, kind, approximate serialized
/// size, and whether it is credential-shaped. Carries NO raw value.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeJsonKey {
    pub name: String,
    pub kind: String,
    pub bytes: i64,
    pub secret: bool,
}

/// One entry in the projects table: path, approximate size, key count, and stale
/// triage. Never carries the entry value.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeJsonProject {
    pub path: String,
    pub bytes: i64,
    pub key_count: i64,
    pub triage: String,
}

/// Full read-only X-ray of `~/.claude.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeJsonCensus {
    pub path: String,
    pub bytes: i64,
    pub top_level: Vec<ClaudeJsonKey>,
    pub flags: Vec<ClaudeJsonKey>,
    pub projects: Vec<ClaudeJsonProject>,
}

/// One enumerated backup file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeJsonBackup {
    pub name: String,
    pub bytes: i64,
    pub mod_time: DateTime<Utc>,
}

/// `~/.claude.json` (home-based, like the CLI writes it).
pub(super) fn claude_json_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "files: cannot resolve home directory".to_string())?;
    Ok(home.join(".claude.json"))
}

/// `~/.claude/backups`.
fn claude_json_backups_dir() -> Result<PathBuf, String> {
    Ok(claude_dir()?.join("backups"))
}

/// Reads `path` and, on any read or JSON-validity failure, retries exactly once
/// after a short delay before giving up with a "try again" error — never
/// "corrupt"/"repair" (the failure is a mid-rewrite race, not damage).
pub(super) fn read_claude_json_with_retry(path: &Path) -> Result<Vec<u8>, String> {
    if let Ok(data) = fs::read(path) {
        if json_valid(&data) {
            return Ok(data);
        }
    }
    std::thread::sleep(CLAUDE_JSON_RETRY_DELAY);
    let data = fs::read(path).map_err(|e| {
        format!("files: could not read ~/.claude.json (the CLI may be rewriting it) — try again: {e}")
    })?;
    if !json_valid(&data) {
        return Err(
            "files: ~/.claude.json is not readable right now (the CLI may be rewriting it) — try again"
                .to_string(),
        );
    }
    Ok(data)
}

pub(super) fn json_valid(data: &[u8]) -> bool {
    serde_json::from_slice::<IgnoredAny>(data).is_ok()
}

/// Reports whether a key name is credential-shaped.
pub(super) fn is_secret_key(key: &str) -> bool {
    SECRET_KEY_PATTERN.is_match(key)
}

/// Reports whether a value is a string matching a known token shape (checked
/// without ever emitting or logging the value itself).
fn is_secret_string_value(value: &Value) -> bool {
    value
        .as_str()
        .map(|s| SECRET_VALUE_PATTERN.is_match(s))
        .unwrap_or(false)
}

/// Returns `value` with every secret-shaped key or value replaced by the mask,
/// recursing into objects (masking children by their own key) and arrays (by
/// value shape). Mirrors `maskJSONValue` exactly. Pure — never mutates input.
pub(super) fn mask_json_value(key: &str, value: &Value) -> Value {
    if is_secret_key(key) || is_secret_string_value(value) {
        return Value::String(CLAUDE_JSON_MASK.to_string());
    }
    match value {
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (k, child) in map {
                out.insert(k.clone(), mask_json_value(k, child));
            }
            Value::Object(out)
        }
        Value::Array(arr) => Value::Array(arr.iter().map(|c| mask_json_value("", c)).collect()),
        _ => value.clone(),
    }
}

/// Names `value`'s JSON type for the census (no value emitted).
fn json_kind(v: &Value) -> &'static str {
    match v {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

/// Byte length of `value` re-serialized as JSON — a size signal only; the
/// serialized bytes are discarded, never returned.
fn approx_size(v: &Value) -> i64 {
    serde_json::to_vec(v).map(|b| b.len() as i64).unwrap_or(0)
}

/// Reports whether `name` is one of the one-off `hasSeen*`/`cached*` flags
/// grouped separately in the census.
fn is_flag_key(name: &str) -> bool {
    name.starts_with("hasSeen") || name.starts_with("cached")
}

/// Read-only census of `~/.claude.json`. Carries no raw values.
pub fn read_claude_json() -> Result<ClaudeJsonCensus, String> {
    let path = claude_json_path()?;
    let data = read_claude_json_with_retry(&path)?;
    let root: serde_json::Map<String, Value> = serde_json::from_slice(&data).map_err(|_| {
        "files: ~/.claude.json is not readable right now (the CLI may be rewriting it) — try again"
            .to_string()
    })?;

    let mut census = ClaudeJsonCensus {
        path: path.to_string_lossy().into_owned(),
        bytes: data.len() as i64,
        top_level: Vec::new(),
        flags: Vec::new(),
        projects: Vec::new(),
    };
    for (name, v) in &root {
        if name == "projects" {
            census.projects = build_project_triage(v);
            continue;
        }
        let key = ClaudeJsonKey {
            name: name.clone(),
            kind: json_kind(v).to_string(),
            bytes: approx_size(v),
            secret: is_secret_key(name) || is_secret_string_value(v),
        };
        if is_flag_key(name) {
            census.flags.push(key);
        } else {
            census.top_level.push(key);
        }
    }

    census.top_level.sort_by(|a, b| a.name.cmp(&b.name));
    census.flags.sort_by(|a, b| a.name.cmp(&b.name));
    census.projects.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(census)
}

/// Builds the projects table with per-entry stale triage.
fn build_project_triage(v: &Value) -> Vec<ClaudeJsonProject> {
    let Some(pm) = v.as_object() else {
        return Vec::new();
    };
    let live_set = live_project_paths();
    let mut out = Vec::with_capacity(pm.len());
    for (path, entry) in pm {
        let key_count = entry.as_object().map(|m| m.len() as i64).unwrap_or(0);
        out.push(ClaudeJsonProject {
            path: path.clone(),
            bytes: approx_size(entry),
            key_count,
            triage: triage_project(path, &live_set).to_string(),
        });
    }
    out
}

/// Lists `~/.claude/projects` and decodes each encoded dir name to its (lossy)
/// original path. Lightweight — NOT a full scan. A missing/unreadable dir yields
/// an empty set.
pub(super) fn live_project_paths() -> HashSet<String> {
    let mut set = HashSet::new();
    let Ok(dir) = projects_dir() else {
        return set;
    };
    let Ok(entries) = fs::read_dir(&dir) else {
        return set;
    };
    for e in entries.flatten() {
        let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if !is_dir {
            continue;
        }
        let decoded = decode_path(&e.file_name().to_string_lossy());
        if !decoded.is_empty() {
            set.insert(decoded);
        }
    }
    set
}

/// Classifies a claude.json project path as live/stale/unverifiable. A `Stat`
/// success is authoritative. A path gone from disk is only ever "stale" when
/// UNAMBIGUOUS: a hyphen in any segment makes the encoded-dir cross-reference
/// lossy, so such a path is "unverifiable" — never a guessed deletion candidate.
pub(super) fn triage_project(path: &str, live_set: &HashSet<String>) -> &'static str {
    match fs::metadata(path) {
        Ok(_) => return TRIAGE_LIVE,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return TRIAGE_UNVERIFIABLE, // permission or other stat error
    }
    if path_has_hyphen_segment(path) {
        return TRIAGE_UNVERIFIABLE;
    }
    if live_set.contains(path) {
        return TRIAGE_LIVE; // an unambiguous projects/ dir still references it
    }
    TRIAGE_STALE
}

/// Reports whether any `/`-delimited segment of `p` contains a hyphen — the
/// exact condition under which Claude Code's dir encoding is lossy.
fn path_has_hyphen_segment(p: &str) -> bool {
    p.split('/').any(|seg| seg.contains('-'))
}

/// Masked JSON of a single top-level key's value for explicit per-value display.
/// Non-secret values render in full; credential-shaped keys/values come back
/// masked. Never surfaces raw token material, never logs the value.
pub fn reveal_claude_json_value(key_path: &str) -> Result<String, String> {
    let path = claude_json_path()?;
    let data = read_claude_json_with_retry(&path)?;
    let root: serde_json::Map<String, Value> = serde_json::from_slice(&data).map_err(|_| {
        "files: ~/.claude.json is not readable right now (the CLI may be rewriting it) — try again"
            .to_string()
    })?;
    let v = root
        .get(key_path)
        .ok_or_else(|| format!("files: key {key_path:?} not found in ~/.claude.json"))?;
    crate::files::json_util::to_go_json_pretty_string(&mask_json_value(key_path, v))
        .map_err(|e| format!("files: marshal revealed value: {e}"))
}

/// Full live `~/.claude.json` server-side-masked, so the inspector can diff
/// live-vs-backup masked-vs-masked without any raw value crossing to the
/// renderer.
pub fn read_claude_json_masked() -> Result<String, String> {
    let path = claude_json_path()?;
    let data = read_claude_json_with_retry(&path)?;
    let root: Value = serde_json::from_slice(&data).map_err(|_| {
        "files: ~/.claude.json is not readable right now (the CLI may be rewriting it) — try again"
            .to_string()
    })?;
    crate::files::json_util::to_go_json_pretty_string(&mask_json_value("", &root))
        .map_err(|e| format!("files: marshal masked ~/.claude.json: {e}"))
}

pub(super) fn system_time_to_utc(t: Option<SystemTime>) -> DateTime<Utc> {
    t.map(DateTime::<Utc>::from)
        .unwrap_or_else(|| DateTime::<Utc>::from(SystemTime::UNIX_EPOCH))
}

/// Enumerates `~/.claude/backups/*.claude.json.backup.*` newest-first. A missing
/// backups dir is not an error (yields an empty list).
pub fn list_claude_json_backups() -> Result<Vec<ClaudeJsonBackup>, String> {
    let dir = claude_json_backups_dir()?;
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("files: read backups dir: {e}")),
    };
    let mut out: Vec<ClaudeJsonBackup> = Vec::new();
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir || !name.contains(".claude.json.backup.") {
            continue;
        }
        let info = match e.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        out.push(ClaudeJsonBackup {
            name,
            bytes: info.len() as i64,
            mod_time: system_time_to_utc(info.modified().ok()),
        });
    }
    out.sort_by(|a, b| b.mod_time.cmp(&a.mod_time));
    Ok(out)
}

/// Rejects anything that isn't a bare backup filename (no separators, no `.`,
/// no `..`) plus the backup-shape match — so this endpoint is never an
/// arbitrary-file read.
fn validate_backup_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.contains('/')
        || name.contains(std::path::MAIN_SEPARATOR)
        || name == "."
        || name == ".."
        || name.contains("..")
    {
        return Err("files: invalid backup file name".to_string());
    }
    if !CLAUDE_JSON_BACKUP_RE.is_match(name) {
        return Err("files: invalid backup file name".to_string());
    }
    Ok(())
}

/// A single backup's server-side-masked JSON so the diff is masked-vs-masked and
/// raw secrets never cross to the renderer. `name` is validated + Confine-checked
/// within the canonical backups dir.
pub fn read_claude_json_backup(name: &str) -> Result<String, String> {
    validate_backup_name(name)?;
    let dir = claude_json_backups_dir()?;
    let canon_dir = fs::canonicalize(&dir).map_err(|e| format!("files: backups dir: {e}"))?;
    let joined = canon_dir.join(name);
    let confined = confine(&joined.to_string_lossy(), &canon_dir.to_string_lossy())?;
    let data = fs::read(&confined).map_err(|e| format!("files: read backup: {e}"))?;
    let root: Value = serde_json::from_slice(&data)
        .map_err(|_| format!("files: backup {name:?} is not readable right now — try again"))?;
    crate::files::json_util::to_go_json_pretty_string(&mask_json_value("", &root))
        .map_err(|e| format!("files: marshal backup: {e}"))
}

#[cfg(test)]
#[path = "claudejson_test_support.rs"]
pub(crate) mod claudejson_test_support;

#[cfg(test)]
#[path = "claudejson_tests.rs"]
mod claudejson_tests;
