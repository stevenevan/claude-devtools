//! Ports `internal/files/claudejson_write.go` — the GUARDED write half: the ONLY
//! code in the app that mutates `~/.claude.json`. Every write is defended in
//! depth: a dedicated mutex, server-side re-triage (never trusting the client),
//! a value-preserving surgical delete of provably-stale project entries only, a
//! structural deny-list that aborts before disk I/O if a credential-shaped key
//! would change, a full UNMASKED app-side backup, a compare-and-swap immediately
//! before the rename, and a post-write re-verify. Auth material is never mutated,
//! never downgraded to a weaker file mode, never clobbered.
//!
//! Also handles add/update/remove of GLOBAL (top-level) `mcpServers` entries
//! under the identical guardrails: same mutex, same fresh-read/CAS/backup/verify
//! shape, same byte-preserving `Box<RawValue>` handling for every untouched key
//! (top-level and sibling server entries alike). Project-scoped
//! `projects[<path>].mcpServers` is never touched by these functions.
//!
//! Faithfulness note: Go keeps each value as `json.RawMessage` so numbers/nested
//! key order survive byte-for-byte. Rust uses `Box<RawValue>` (serde_json
//! `raw_value` feature) for the identical guarantee — `serde_json::Value` would
//! coerce big integers to `f64` and re-sort nested keys, mutating the file and
//! tripping the guard. `BTreeMap` re-marshals with sorted keys, matching Go's
//! `json.Marshal` map ordering; `pretty_indent` mirrors `json.Indent`.

use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use serde_json::Value;

use crate::config::root::app_data_dir;

use super::claudejson::{
    claude_json_path, is_secret_key, json_valid, live_project_paths, read_claude_json_with_retry,
    system_time_to_utc, triage_project, ClaudeJsonBackup, CLAUDE_JSON_MASK, TRIAGE_STALE,
};
use super::fsutil;
use super::pathutil::confine;

/// Serializes every `~/.claude.json` write. Dedicated on purpose — it must NEVER
/// be the settings mutex; the two files are independent.
static CLAUDE_JSON_WRITE_MU: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

/// Signals that the CLI rewrote `~/.claude.json` inside our read→rename window.
/// The ONE retryable failure (one retry from a fresh read); a second conflict is
/// surfaced, never looped. String sentinel is byte-identical to the Go error.
pub(super) const ERR_CLAUDE_JSON_CONFLICT: &str = "files: ~/.claude.json changed on disk during the purge (the CLI wrote concurrently) — no changes were made; please refresh and try again";

const ERR_TRY_AGAIN: &str =
    "files: ~/.claude.json is not readable right now (the CLI may be rewriting it) — try again";

/// TEST-ONLY seam: runs once inside a purge attempt right after the fresh read
/// and before the compare-and-swap re-read, to simulate a concurrent CLI rewrite
/// landing in the read→rename window. Absent (nil) in production builds.
#[cfg(test)]
pub(super) static CLAUDE_JSON_WRITE_RACE_HOOK: Mutex<Option<Box<dyn Fn() + Send>>> =
    Mutex::new(None);

#[cfg(test)]
fn run_race_hook() {
    let guard = CLAUDE_JSON_WRITE_RACE_HOOK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if let Some(hook) = guard.as_ref() {
        hook();
    }
}

/// Outcome of a purge: which project keys were removed, size before/after, and
/// the app-side backup filename created before the write.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurgeResult {
    pub removed_keys: Vec<String>,
    pub bytes_before: i64,
    pub bytes_after: i64,
    pub backup_name: String,
}

/// `<AppDataDir>/claude-json-backups` — the app's OWN pre-write backup store.
/// Never `~/.claude/backups` (the CLI owns that dir).
fn claude_json_app_backups_dir() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("claude-json-backups"))
}

/// Writes `data` to `path` via temp+rename, PRESERVING the file's existing
/// permission mode (default 0o600 if absent). Chmods the temp to that exact mode
/// so the rename can never downgrade `~/.claude.json` to world-readable.
fn atomic_write_claude_json(path: &Path, data: &[u8]) -> Result<(), String> {
    let mut mode: u32 = 0o600;
    if let Ok(info) = fs::metadata(path) {
        mode = info.permissions().mode() & 0o777;
    }
    let mut tmp_os = path.as_os_str().to_os_string();
    tmp_os.push(".tmp");
    let tmp_path = PathBuf::from(tmp_os);
    let base = tmp_path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();

    fsutil::write_file_mode(&tmp_path, data, mode)
        .map_err(|e| format!("files: write {base}: {e}"))?;
    if let Err(e) = fsutil::set_mode(&tmp_path, mode) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("files: chmod {base}: {e}"));
    }
    if let Err(e) = fs::rename(&tmp_path, path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("files: rename {base}: {e}"));
    }
    Ok(())
}

fn unix_nano() -> u128 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

/// Copies `data` to `<AppDataDir>/claude-json-backups` as a timestamped
/// `.claude.json.bak`, creating the dir at 0o700 and the file at 0o600 (it is a
/// full UNMASKED copy of auth material). Returns the backup's bare filename.
fn write_claude_json_app_backup(data: &[u8]) -> Result<String, String> {
    let dir = claude_json_app_backups_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("files: mkdir app backups dir: {e}"))?;
    fsutil::set_mode(&dir, 0o700).map_err(|e| format!("files: chmod app backups dir: {e}"))?;
    let name = format!("{}.claude.json.bak", unix_nano());
    let dst = dir.join(&name);
    fsutil::write_file_mode(&dst, data, 0o600).map_err(|e| format!("files: write app backup: {e}"))?;
    fsutil::set_mode(&dst, 0o600).map_err(|e| format!("files: chmod app backup: {e}"))?;
    Ok(name)
}

/// Removes insignificant whitespace outside strings (order-preserving), mirroring
/// `json.Compact`. String bodies (incl. escapes) are copied verbatim.
fn json_compact(src: &[u8]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::with_capacity(src.len());
    let mut i = 0;
    while i < src.len() {
        let c = src[i];
        if c == b'"' {
            out.push(c);
            i += 1;
            while i < src.len() {
                let d = src[i];
                out.push(d);
                i += 1;
                if d == b'\\' {
                    if i < src.len() {
                        out.push(src[i]);
                        i += 1;
                    }
                } else if d == b'"' {
                    break;
                }
            }
            continue;
        }
        if c == b' ' || c == b'\t' || c == b'\n' || c == b'\r' {
            i += 1;
            continue;
        }
        out.push(c);
        i += 1;
    }
    out
}

/// Reports whether two raw JSON values are content-identical ignoring
/// insignificant whitespace (the property protecting auth material). Mirrors
/// `compactRawEqual`.
pub(super) fn compact_raw_equal(a: &str, b: &str) -> bool {
    json_compact(a.as_bytes()) == json_compact(b.as_bytes())
}

fn newline(out: &mut Vec<u8>, depth: usize) {
    out.push(b'\n');
    for _ in 0..depth {
        out.extend_from_slice(b"  ");
    }
}

/// Re-indents a JSON byte stream with 2-space indentation, mirroring
/// `json.Indent` (empty object/array stays compact; a space follows each colon;
/// insignificant whitespace is dropped and rebuilt). Byte-oriented so multi-byte
/// UTF-8 inside strings is preserved. `pub(crate)` so the test fixture builder
/// can render pre-images in the identical format the purge writes.
pub(crate) fn pretty_indent(src: &[u8]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::with_capacity(src.len() + src.len() / 2 + 16);
    let mut depth: usize = 0;
    let mut need_indent = false;
    let mut i = 0;
    while i < src.len() {
        let c = src[i];
        if c == b'"' {
            if need_indent {
                need_indent = false;
                depth += 1;
                newline(&mut out, depth);
            }
            out.push(c);
            i += 1;
            while i < src.len() {
                let d = src[i];
                out.push(d);
                i += 1;
                if d == b'\\' {
                    if i < src.len() {
                        out.push(src[i]);
                        i += 1;
                    }
                } else if d == b'"' {
                    break;
                }
            }
            continue;
        }
        if c == b' ' || c == b'\t' || c == b'\n' || c == b'\r' {
            i += 1;
            continue;
        }
        let is_close = c == b'}' || c == b']';
        if need_indent && !is_close {
            need_indent = false;
            depth += 1;
            newline(&mut out, depth);
        }
        match c {
            b'{' | b'[' => {
                need_indent = true;
                out.push(c);
            }
            b',' => {
                out.push(c);
                newline(&mut out, depth);
            }
            b':' => {
                out.push(c);
                out.push(b' ');
            }
            b'}' | b']' => {
                if need_indent {
                    need_indent = false;
                } else {
                    depth = depth.saturating_sub(1);
                    newline(&mut out, depth);
                }
                out.push(c);
            }
            _ => out.push(c),
        }
        i += 1;
    }
    out
}

/// Removes the given project-entry keys from `~/.claude.json`. Every key is
/// re-triaged server-side and must be provably stale; a single
/// live/unverifiable/absent/credential-shaped key rejects the WHOLE purge (no
/// partial writes). Holds the write mutex across a single CAS-guarded retry.
pub fn purge_claude_json_projects(keys: &[String]) -> Result<PurgeResult, String> {
    if keys.is_empty() {
        return Err("files: no project entries selected for purge".to_string());
    }

    let _guard = fsutil::lock(&CLAUDE_JSON_WRITE_MU);

    let mut attempt = 0;
    loop {
        let result = purge_claude_json_projects_once(keys);
        if let Err(ref e) = result {
            if e == ERR_CLAUDE_JSON_CONFLICT && attempt == 0 {
                attempt += 1;
                continue; // one retry from a fresh read
            }
        }
        return result;
    }
}

/// One full purge attempt. The caller holds the write mutex. Reads fresh,
/// re-triages, deletes surgically, guards against any non-project mutation, backs
/// up, CAS-checks, writes, and re-verifies.
fn purge_claude_json_projects_once(keys: &[String]) -> Result<PurgeResult, String> {
    let path = claude_json_path()?;

    // Step 1: read fresh; keep the raw pre-image. Corrupt/mid-rewrite → error,
    // don't touch the file.
    let pre = read_claude_json_with_retry(&path)?;

    #[cfg(test)]
    run_race_hook();

    // Pristine reference + mutable working copy from the same bytes. RawValue
    // keeps each value's raw bytes, so numbers/big-ints survive losslessly.
    let pre_top: BTreeMap<String, Box<RawValue>> =
        serde_json::from_slice(&pre).map_err(|_| ERR_TRY_AGAIN.to_string())?;
    let mut top_raw: BTreeMap<String, Box<RawValue>> =
        serde_json::from_slice(&pre).map_err(|_| ERR_TRY_AGAIN.to_string())?;

    let mut projects_map: BTreeMap<String, Box<RawValue>> = match top_raw.get("projects") {
        Some(pv) => serde_json::from_str(pv.get()).map_err(|_| {
            "files: ~/.claude.json projects block is not readable right now — try again".to_string()
        })?,
        None => BTreeMap::new(),
    };

    // Step 2: re-triage EVERY requested key server-side. Never trust the client.
    let live_set = live_project_paths();
    for k in keys {
        if !projects_map.contains_key(k) {
            return Err(format!(
                "files: refusing purge: {k:?} is not a project entry in ~/.claude.json"
            ));
        }
        if triage_project(k, &live_set) != TRIAGE_STALE {
            return Err(format!(
                "files: refusing purge: {k:?} is not provably stale (live or unverifiable) — not purgeable"
            ));
        }
    }

    // Step 3: delete exactly the requested keys, re-marshal, restore 2-space
    // pretty-print.
    for k in keys {
        projects_map.remove(k);
    }
    let new_projects =
        serde_json::to_string(&projects_map).map_err(|e| format!("files: marshal projects: {e}"))?;
    let new_projects_raw =
        RawValue::from_string(new_projects).map_err(|e| format!("files: marshal projects: {e}"))?;
    top_raw.insert("projects".to_string(), new_projects_raw);
    let compact =
        serde_json::to_vec(&top_raw).map_err(|e| format!("files: marshal ~/.claude.json: {e}"))?;
    let out = pretty_indent(&compact);

    // Structural deny-list guard on the ACTUAL bytes we are about to write.
    guard_purge_output(&out, &pre_top, keys)?;

    // Step 4: app-side backup of the full unmasked pre-image BEFORE the rename.
    let backup_name = write_claude_json_app_backup(&pre)?;

    // Step 5: compare-and-swap immediately before the rename. A read error or any
    // difference means the CLI wrote during our window — abort (retryable).
    match fs::read(&path) {
        Ok(cur) if cur == pre => {}
        _ => return Err(ERR_CLAUDE_JSON_CONFLICT.to_string()),
    }
    atomic_write_claude_json(&path, &out)?;

    // Step 6: post-write re-verify — purged keys absent AND no credential key
    // mutated. Surface, no loop.
    verify_purge_applied(&path, &pre_top, keys)?;

    Ok(PurgeResult {
        removed_keys: keys.to_vec(),
        bytes_before: pre.len() as i64,
        bytes_after: out.len() as i64,
        backup_name,
    })
}

/// Proves that `out` differs from the pre-image ONLY by the removal of the
/// requested project keys: the top-level key set is unchanged, every non-project
/// value is content-identical (auth included), and within "projects" only the
/// requested keys are absent while everything else is byte-preserved.
fn guard_purge_output(
    out: &[u8],
    pre_top: &BTreeMap<String, Box<RawValue>>,
    keys: &[String],
) -> Result<(), String> {
    let out_top: BTreeMap<String, Box<RawValue>> = serde_json::from_slice(out)
        .map_err(|_| "files: purge produced unreadable JSON — aborting".to_string())?;

    if out_top.len() != pre_top.len() {
        return Err("files: purge would change the top-level key set — aborting".to_string());
    }
    for (k, pre_val) in pre_top {
        let Some(out_val) = out_top.get(k) else {
            return Err(format!("files: purge would drop top-level key {k:?} — aborting"));
        };
        if k == "projects" {
            continue;
        }
        if !compact_raw_equal(pre_val.get(), out_val.get()) {
            if is_secret_key(k) {
                return Err(format!("files: purge would mutate credential key {k:?} — aborting"));
            }
            return Err(format!("files: purge would mutate top-level key {k:?} — aborting"));
        }
    }

    let pre_pm: BTreeMap<String, Box<RawValue>> = {
        let pv = pre_top
            .get("projects")
            .ok_or_else(|| "files: ~/.claude.json projects block unreadable — try again".to_string())?;
        serde_json::from_str(pv.get())
            .map_err(|_| "files: ~/.claude.json projects block unreadable — try again".to_string())?
    };
    let out_pm: BTreeMap<String, Box<RawValue>> = {
        let pv = out_top.get("projects").ok_or_else(|| {
            "files: purge produced an unreadable projects block — aborting".to_string()
        })?;
        serde_json::from_str(pv.get())
            .map_err(|_| "files: purge produced an unreadable projects block — aborting".to_string())?
    };
    let requested: HashSet<&String> = keys.iter().collect();
    for (k, pre_val) in &pre_pm {
        if requested.contains(k) {
            if out_pm.contains_key(k) {
                return Err(format!("files: purge failed to remove project {k:?} — aborting"));
            }
            continue;
        }
        match out_pm.get(k) {
            Some(out_val) if compact_raw_equal(pre_val.get(), out_val.get()) => {}
            _ => return Err(format!("files: purge would alter unrelated project {k:?} — aborting")),
        }
    }
    if out_pm.len() != pre_pm.len() - requested.len() {
        return Err("files: purge changed the project count unexpectedly — aborting".to_string());
    }
    Ok(())
}

/// Re-reads the live file after the write and confirms the purged keys are gone
/// and no credential-shaped top-level key changed relative to the pre-image
/// (catching a CLI rewrite that lands right after our rename).
fn verify_purge_applied(
    path: &Path,
    pre_top: &BTreeMap<String, Box<RawValue>>,
    keys: &[String],
) -> Result<(), String> {
    let after = read_claude_json_with_retry(path).map_err(|e| {
        format!("files: purge written but ~/.claude.json could not be re-verified — please refresh: {e}")
    })?;
    let after_top: BTreeMap<String, Box<RawValue>> = serde_json::from_slice(&after).map_err(|_| {
        "files: purge written but ~/.claude.json is not readable for verification — please refresh"
            .to_string()
    })?;
    let after_pm: BTreeMap<String, Box<RawValue>> = match after_top.get("projects") {
        Some(pv) => serde_json::from_str(pv.get()).unwrap_or_default(),
        None => BTreeMap::new(),
    };
    for k in keys {
        if after_pm.contains_key(k) {
            return Err(format!(
                "files: {k:?} reappeared in ~/.claude.json after purge (the CLI rewrote it) — please refresh and retry"
            ));
        }
    }
    for (k, pre_val) in pre_top {
        if k == "projects" || !is_secret_key(k) {
            continue;
        }
        match after_top.get(k) {
            Some(after_val) if compact_raw_equal(pre_val.get(), after_val.get()) => {}
            _ => {
                return Err(format!(
                    "files: credential key {k:?} changed in ~/.claude.json right after purge (CLI activity) — please verify your auth and refresh"
                ))
            }
        }
    }
    Ok(())
}

// ── global mcpServers add/edit/remove ──
//
// Same guardrails as the purge above: dedicated mutex, fresh read, a
// structural guard on the actual output bytes before any I/O, an app-side
// backup, a CAS re-read immediately before the rename, a single retry on
// conflict, and a post-write re-verify. Only the top-level `mcpServers` key is
// ever touched; every other top-level key (including `projects` and any
// project-scoped `mcpServers`) stays byte-identical.

/// Transport types accepted for the `type` field on any server.
const MCP_TYPES: [&str; 5] = ["stdio", "http", "streamable-http", "sse", "ws"];
/// Transport types valid when a server has a `url` and no `command` — a bare
/// `url` with no `type` is a documented Claude Code configuration error.
const MCP_URL_TYPES: [&str; 4] = ["http", "streamable-http", "sse", "ws"];

fn validate_mcp_server_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.chars().any(|c| c.is_control()) {
        return Err("files: invalid MCP server name".to_string());
    }
    Ok(())
}

fn non_empty_str(v: Option<&Value>) -> Option<&str> {
    v.and_then(Value::as_str).filter(|s| !s.is_empty())
}

/// Reports whether any string leaf anywhere in `v` equals the mask placeholder
/// — a mask reaching the writer would overwrite the real credential.
fn contains_mask_value(v: &Value) -> bool {
    match v {
        Value::String(s) => s == CLAUDE_JSON_MASK,
        Value::Array(items) => items.iter().any(contains_mask_value),
        Value::Object(map) => map.values().any(contains_mask_value),
        _ => false,
    }
}

/// Validates one server config (an `add`'s full config, or an `update`'s
/// merged result): must be an object, must carry a non-empty `command` or
/// `url`, a url-only server must declare a valid `type`, `args`/`env`/`headers`
/// must be shaped correctly if present, and no field may carry the mask
/// placeholder. Unknown fields are passed through untouched (not rejected).
fn validate_mcp_server_config(config: &Value) -> Result<(), String> {
    let Some(obj) = config.as_object() else {
        return Err("files: MCP server config must be a JSON object".to_string());
    };
    if contains_mask_value(config) {
        return Err(
            "files: MCP server config contains a masked placeholder value — refusing to write"
                .to_string(),
        );
    }

    let command = non_empty_str(obj.get("command"));
    let url = non_empty_str(obj.get("url"));
    if command.is_none() && url.is_none() {
        return Err(
            "files: MCP server config must have a non-empty \"command\" or \"url\"".to_string(),
        );
    }

    let type_val = match obj.get("type") {
        Some(v) => Some(
            v.as_str()
                .ok_or_else(|| "files: MCP server \"type\" must be a string".to_string())?,
        ),
        None => None,
    };
    if command.is_none() {
        match type_val {
            Some(t) if MCP_URL_TYPES.contains(&t) => {}
            _ => {
                return Err(format!(
                    "files: an MCP server with a \"url\" and no \"command\" requires \"type\" to be one of {MCP_URL_TYPES:?}"
                ))
            }
        }
    } else if let Some(t) = type_val {
        if !MCP_TYPES.contains(&t) {
            return Err(format!(
                "files: invalid MCP server \"type\" {t:?} (want one of {MCP_TYPES:?})"
            ));
        }
    }

    if let Some(args) = obj.get("args") {
        let valid = args.as_array().is_some_and(|a| a.iter().all(Value::is_string));
        if !valid {
            return Err("files: MCP server \"args\" must be an array of strings".to_string());
        }
    }
    for key in ["env", "headers"] {
        if let Some(v) = obj.get(key) {
            let valid = v.as_object().is_some_and(|m| m.values().all(Value::is_string));
            if !valid {
                return Err(format!(
                    "files: MCP server {key:?} must be an object of string values"
                ));
            }
        }
    }
    Ok(())
}

/// Parses the top-level `mcpServers` block into a raw map, or an empty map when
/// the key is absent (mirrors the `projects` `None` branch in the purge above —
/// `add` is what creates the block).
fn mcp_servers_map(top: &BTreeMap<String, Box<RawValue>>) -> Result<BTreeMap<String, Box<RawValue>>, String> {
    match top.get("mcpServers") {
        Some(v) => serde_json::from_str(v.get()).map_err(|_| {
            "files: ~/.claude.json mcpServers block is not readable right now — try again"
                .to_string()
        }),
        None => Ok(BTreeMap::new()),
    }
}

/// Which single-server mutation `guard_mcp_write_output`/`verify_mcp_write_applied`
/// are checking the output of.
#[derive(Clone, Copy, PartialEq, Eq)]
enum McpOp {
    Add,
    Update,
    Remove,
}

/// Proves that `out` differs from the pre-image ONLY by the `name` entry inside
/// `mcpServers`: every other top-level key (and, within `mcpServers`, every
/// other server entry) is content-identical, `mcpServers` is created if it was
/// absent, and `name` ends up present (add/update) or absent (remove) with the
/// expected resulting server count.
fn guard_mcp_write_output(
    out: &[u8],
    pre_top: &BTreeMap<String, Box<RawValue>>,
    name: &str,
    op: McpOp,
) -> Result<(), String> {
    let out_top: BTreeMap<String, Box<RawValue>> = serde_json::from_slice(out)
        .map_err(|_| "files: MCP server write produced unreadable JSON — aborting".to_string())?;

    let pre_has_mcp = pre_top.contains_key("mcpServers");
    let expected_top_len = if pre_has_mcp { pre_top.len() } else { pre_top.len() + 1 };
    if out_top.len() != expected_top_len {
        return Err(
            "files: MCP server write would change the top-level key set — aborting".to_string(),
        );
    }
    for (k, pre_val) in pre_top {
        let Some(out_val) = out_top.get(k) else {
            return Err(format!(
                "files: MCP server write would drop top-level key {k:?} — aborting"
            ));
        };
        if k == "mcpServers" {
            continue;
        }
        if !compact_raw_equal(pre_val.get(), out_val.get()) {
            if is_secret_key(k) {
                return Err(format!(
                    "files: MCP server write would mutate credential key {k:?} — aborting"
                ));
            }
            return Err(format!(
                "files: MCP server write would mutate top-level key {k:?} — aborting"
            ));
        }
    }
    if !out_top.contains_key("mcpServers") {
        return Err(
            "files: MCP server write did not produce an mcpServers block — aborting".to_string(),
        );
    }

    let pre_sm: BTreeMap<String, Box<RawValue>> = match pre_top.get("mcpServers") {
        Some(v) => serde_json::from_str(v.get()).map_err(|_| {
            "files: ~/.claude.json mcpServers block unreadable — try again".to_string()
        })?,
        None => BTreeMap::new(),
    };
    let out_sm: BTreeMap<String, Box<RawValue>> = {
        let v = out_top.get("mcpServers").expect("checked above");
        serde_json::from_str(v.get()).map_err(|_| {
            "files: MCP server write produced an unreadable mcpServers block — aborting".to_string()
        })?
    };

    for (k, pre_val) in &pre_sm {
        if k == name {
            continue; // the target entry is allowed to change per op
        }
        match out_sm.get(k) {
            Some(out_val) if compact_raw_equal(pre_val.get(), out_val.get()) => {}
            _ => {
                return Err(format!(
                    "files: MCP server write would alter unrelated server {k:?} — aborting"
                ))
            }
        }
    }

    match op {
        McpOp::Add | McpOp::Update => {
            if !out_sm.contains_key(name) {
                return Err(format!(
                    "files: MCP server write failed to write server {name:?} — aborting"
                ));
            }
        }
        McpOp::Remove => {
            if out_sm.contains_key(name) {
                return Err(format!(
                    "files: MCP server write failed to remove server {name:?} — aborting"
                ));
            }
        }
    }

    let expected_sm_len = match op {
        McpOp::Add => pre_sm.len() + 1,
        McpOp::Update => pre_sm.len(),
        McpOp::Remove => pre_sm.len() - 1,
    };
    if out_sm.len() != expected_sm_len {
        return Err(
            "files: MCP server write changed the server count unexpectedly — aborting".to_string(),
        );
    }
    Ok(())
}

/// Re-reads the live file after the write and confirms `name` ended up
/// present/absent as expected and no credential-shaped top-level key changed
/// relative to the pre-image (catching a CLI rewrite landing right after our
/// rename).
fn verify_mcp_write_applied(
    path: &Path,
    pre_top: &BTreeMap<String, Box<RawValue>>,
    name: &str,
    op: McpOp,
) -> Result<(), String> {
    let after = read_claude_json_with_retry(path).map_err(|e| {
        format!(
            "files: MCP server write written but ~/.claude.json could not be re-verified — please refresh: {e}"
        )
    })?;
    let after_top: BTreeMap<String, Box<RawValue>> = serde_json::from_slice(&after).map_err(|_| {
        "files: MCP server write written but ~/.claude.json is not readable for verification — please refresh"
            .to_string()
    })?;
    let after_sm: BTreeMap<String, Box<RawValue>> = match after_top.get("mcpServers") {
        Some(v) => serde_json::from_str(v.get()).unwrap_or_default(),
        None => BTreeMap::new(),
    };
    match op {
        McpOp::Add | McpOp::Update => {
            if !after_sm.contains_key(name) {
                return Err(format!(
                    "files: MCP server {name:?} missing from ~/.claude.json after write (the CLI may have rewritten it) — please refresh and retry"
                ));
            }
        }
        McpOp::Remove => {
            if after_sm.contains_key(name) {
                return Err(format!(
                    "files: MCP server {name:?} reappeared in ~/.claude.json after removal (the CLI rewrote it) — please refresh and retry"
                ));
            }
        }
    }
    for (k, pre_val) in pre_top {
        if k == "mcpServers" || !is_secret_key(k) {
            continue;
        }
        match after_top.get(k) {
            Some(after_val) if compact_raw_equal(pre_val.get(), after_val.get()) => {}
            _ => {
                return Err(format!(
                    "files: credential key {k:?} changed in ~/.claude.json right after an MCP server write (CLI activity) — please verify your auth and refresh"
                ))
            }
        }
    }
    Ok(())
}

/// Adds one server to the top-level `mcpServers` block, creating the block if
/// absent. Rejects a duplicate `name`. Holds the write mutex across a single
/// CAS-guarded retry, exactly like the purge above.
pub fn add_global_mcp_server(name: &str, config: Value) -> Result<(), String> {
    validate_mcp_server_name(name)?;
    validate_mcp_server_config(&config)?;

    let _guard = fsutil::lock(&CLAUDE_JSON_WRITE_MU);

    let mut attempt = 0;
    loop {
        let result = add_global_mcp_server_once(name, &config);
        if let Err(ref e) = result {
            if e == ERR_CLAUDE_JSON_CONFLICT && attempt == 0 {
                attempt += 1;
                continue; // one retry from a fresh read
            }
        }
        return result;
    }
}

fn add_global_mcp_server_once(name: &str, config: &Value) -> Result<(), String> {
    let path = claude_json_path()?;
    let pre = read_claude_json_with_retry(&path)?;

    #[cfg(test)]
    run_race_hook();

    let pre_top: BTreeMap<String, Box<RawValue>> =
        serde_json::from_slice(&pre).map_err(|_| ERR_TRY_AGAIN.to_string())?;
    let mut top_raw: BTreeMap<String, Box<RawValue>> =
        serde_json::from_slice(&pre).map_err(|_| ERR_TRY_AGAIN.to_string())?;

    let mut servers_map = mcp_servers_map(&top_raw)?;
    if servers_map.contains_key(name) {
        return Err(format!(
            "files: refusing add: MCP server {name:?} already exists in ~/.claude.json"
        ));
    }
    let config_raw = RawValue::from_string(
        serde_json::to_string(config).map_err(|e| format!("files: marshal MCP server config: {e}"))?,
    )
    .map_err(|e| format!("files: marshal MCP server config: {e}"))?;
    servers_map.insert(name.to_string(), config_raw);

    let new_servers_raw = RawValue::from_string(
        serde_json::to_string(&servers_map).map_err(|e| format!("files: marshal mcpServers: {e}"))?,
    )
    .map_err(|e| format!("files: marshal mcpServers: {e}"))?;
    top_raw.insert("mcpServers".to_string(), new_servers_raw);

    let compact =
        serde_json::to_vec(&top_raw).map_err(|e| format!("files: marshal ~/.claude.json: {e}"))?;
    let out = pretty_indent(&compact);

    guard_mcp_write_output(&out, &pre_top, name, McpOp::Add)?;
    write_claude_json_app_backup(&pre)?;

    match fs::read(&path) {
        Ok(cur) if cur == pre => {}
        _ => return Err(ERR_CLAUDE_JSON_CONFLICT.to_string()),
    }
    atomic_write_claude_json(&path, &out)?;

    verify_mcp_write_applied(&path, &pre_top, name, McpOp::Add)
}

/// Shallow-merges `patch` into the existing `mcpServers[name]` entry at the
/// RawValue level: only the fields named in `patch` are replaced, every other
/// field of the existing entry (masked secrets included) stays byte-identical.
/// Requires `name` to already exist. Holds the write mutex across a single
/// CAS-guarded retry, exactly like the purge above.
pub fn update_global_mcp_server(name: &str, patch: Value) -> Result<(), String> {
    validate_mcp_server_name(name)?;
    if !patch.is_object() {
        return Err("files: MCP server patch must be a JSON object".to_string());
    }
    if contains_mask_value(&patch) {
        return Err(
            "files: MCP server patch contains a masked placeholder value — refusing to write"
                .to_string(),
        );
    }

    let _guard = fsutil::lock(&CLAUDE_JSON_WRITE_MU);

    let mut attempt = 0;
    loop {
        let result = update_global_mcp_server_once(name, &patch);
        if let Err(ref e) = result {
            if e == ERR_CLAUDE_JSON_CONFLICT && attempt == 0 {
                attempt += 1;
                continue; // one retry from a fresh read
            }
        }
        return result;
    }
}

fn update_global_mcp_server_once(name: &str, patch: &Value) -> Result<(), String> {
    let path = claude_json_path()?;
    let pre = read_claude_json_with_retry(&path)?;

    #[cfg(test)]
    run_race_hook();

    let pre_top: BTreeMap<String, Box<RawValue>> =
        serde_json::from_slice(&pre).map_err(|_| ERR_TRY_AGAIN.to_string())?;
    let mut top_raw: BTreeMap<String, Box<RawValue>> =
        serde_json::from_slice(&pre).map_err(|_| ERR_TRY_AGAIN.to_string())?;

    let mut servers_map = mcp_servers_map(&top_raw)?;
    let Some(existing_raw) = servers_map.get(name) else {
        return Err(format!(
            "files: refusing update: MCP server {name:?} does not exist in ~/.claude.json"
        ));
    };
    let mut fields: BTreeMap<String, Box<RawValue>> = serde_json::from_str(existing_raw.get())
        .map_err(|_| format!("files: MCP server {name:?} is not an object — cannot merge"))?;

    // patch is validated as an object in the public wrapper.
    let patch_obj = patch.as_object().expect("validated as object above");
    for (k, v) in patch_obj {
        let v_raw = RawValue::from_string(
            serde_json::to_string(v).map_err(|e| format!("files: marshal patch field {k:?}: {e}"))?,
        )
        .map_err(|e| format!("files: marshal patch field {k:?}: {e}"))?;
        fields.insert(k.clone(), v_raw);
    }

    let merged_str =
        serde_json::to_string(&fields).map_err(|e| format!("files: marshal merged MCP server: {e}"))?;
    let merged_value: Value = serde_json::from_str(&merged_str)
        .map_err(|e| format!("files: marshal merged MCP server: {e}"))?;
    validate_mcp_server_config(&merged_value)?;

    let merged_raw = RawValue::from_string(merged_str)
        .map_err(|e| format!("files: marshal merged MCP server: {e}"))?;
    servers_map.insert(name.to_string(), merged_raw);

    let new_servers_raw = RawValue::from_string(
        serde_json::to_string(&servers_map).map_err(|e| format!("files: marshal mcpServers: {e}"))?,
    )
    .map_err(|e| format!("files: marshal mcpServers: {e}"))?;
    top_raw.insert("mcpServers".to_string(), new_servers_raw);

    let compact =
        serde_json::to_vec(&top_raw).map_err(|e| format!("files: marshal ~/.claude.json: {e}"))?;
    let out = pretty_indent(&compact);

    guard_mcp_write_output(&out, &pre_top, name, McpOp::Update)?;
    write_claude_json_app_backup(&pre)?;

    match fs::read(&path) {
        Ok(cur) if cur == pre => {}
        _ => return Err(ERR_CLAUDE_JSON_CONFLICT.to_string()),
    }
    atomic_write_claude_json(&path, &out)?;

    verify_mcp_write_applied(&path, &pre_top, name, McpOp::Update)
}

/// Removes one server from the top-level `mcpServers` block. Requires `name` to
/// already exist. Holds the write mutex across a single CAS-guarded retry,
/// exactly like the purge above.
pub fn remove_global_mcp_server(name: &str) -> Result<(), String> {
    validate_mcp_server_name(name)?;

    let _guard = fsutil::lock(&CLAUDE_JSON_WRITE_MU);

    let mut attempt = 0;
    loop {
        let result = remove_global_mcp_server_once(name);
        if let Err(ref e) = result {
            if e == ERR_CLAUDE_JSON_CONFLICT && attempt == 0 {
                attempt += 1;
                continue; // one retry from a fresh read
            }
        }
        return result;
    }
}

fn remove_global_mcp_server_once(name: &str) -> Result<(), String> {
    let path = claude_json_path()?;
    let pre = read_claude_json_with_retry(&path)?;

    #[cfg(test)]
    run_race_hook();

    let pre_top: BTreeMap<String, Box<RawValue>> =
        serde_json::from_slice(&pre).map_err(|_| ERR_TRY_AGAIN.to_string())?;
    let mut top_raw: BTreeMap<String, Box<RawValue>> =
        serde_json::from_slice(&pre).map_err(|_| ERR_TRY_AGAIN.to_string())?;

    let mut servers_map = mcp_servers_map(&top_raw)?;
    if !servers_map.contains_key(name) {
        return Err(format!(
            "files: refusing remove: MCP server {name:?} does not exist in ~/.claude.json"
        ));
    }
    servers_map.remove(name);

    let new_servers_raw = RawValue::from_string(
        serde_json::to_string(&servers_map).map_err(|e| format!("files: marshal mcpServers: {e}"))?,
    )
    .map_err(|e| format!("files: marshal mcpServers: {e}"))?;
    top_raw.insert("mcpServers".to_string(), new_servers_raw);

    let compact =
        serde_json::to_vec(&top_raw).map_err(|e| format!("files: marshal ~/.claude.json: {e}"))?;
    let out = pretty_indent(&compact);

    guard_mcp_write_output(&out, &pre_top, name, McpOp::Remove)?;
    write_claude_json_app_backup(&pre)?;

    match fs::read(&path) {
        Ok(cur) if cur == pre => {}
        _ => return Err(ERR_CLAUDE_JSON_CONFLICT.to_string()),
    }
    atomic_write_claude_json(&path, &out)?;

    verify_mcp_write_applied(&path, &pre_top, name, McpOp::Remove)
}

/// Enumerates `<AppDataDir>/claude-json-backups/*.claude.json.bak` newest-first.
/// A missing dir yields an empty list, not an error.
pub fn list_claude_json_app_backups() -> Result<Vec<ClaudeJsonBackup>, String> {
    let dir = claude_json_app_backups_dir()?;
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("files: read app backups dir: {e}")),
    };
    let mut out: Vec<ClaudeJsonBackup> = Vec::new();
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir || !name.ends_with(".claude.json.bak") {
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

/// Dedicated `.bak`-shape validator for the app's own backups (NOT the CLI's
/// `.claude.json.backup.<suffix>` shape). Rejects empty, `.`, `..`, any `..`
/// substring, and any path separator.
fn validate_claude_json_app_backup_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains('/')
        || name.contains(std::path::MAIN_SEPARATOR)
        || name.contains("..")
    {
        return Err("files: invalid backup file name".to_string());
    }
    if !name.ends_with(".claude.json.bak") {
        return Err("files: invalid backup file name".to_string());
    }
    Ok(())
}

/// Replaces the live `~/.claude.json` with the FULL contents of the named
/// app-side backup (not the projects-only guard, which would reject a legitimate
/// restore whose auth keys differ). The current file is backed up first. Reverts
/// ALL state — including auth — to the backup point.
pub fn restore_claude_json_app_backup(name: &str) -> Result<(), String> {
    validate_claude_json_app_backup_name(name)?;
    let dir = claude_json_app_backups_dir()?;
    let canon_dir = fs::canonicalize(&dir).map_err(|e| format!("files: app backups dir: {e}"))?;
    let joined = canon_dir.join(name);
    let confined = confine(&joined.to_string_lossy(), &canon_dir.to_string_lossy())?;
    let data = fs::read(&confined).map_err(|e| format!("files: read backup: {e}"))?;
    if !json_valid(&data) {
        return Err(format!("files: backup {name:?} is not valid JSON — refusing to restore"));
    }

    let _guard = fsutil::lock(&CLAUDE_JSON_WRITE_MU);

    let path = claude_json_path()?;
    if let Ok(cur) = fs::read(&path) {
        write_claude_json_app_backup(&cur)?;
    }
    atomic_write_claude_json(&path, &data)
}

#[cfg(test)]
#[path = "claudejson_write_tests.rs"]
mod claudejson_write_tests;
