//! Ports `internal/maintenance/history.go` — the `history.jsonl` histogram +
//! age-split. `analyze_history` is a read-only monthly histogram; `prune_history`
//! splits at the cutoff and TRASHES the aged tail (via an INJECTED trash closure,
//! never a direct trash import) then atomically replaces the file with the
//! retained head. Guards reproduced verbatim (invariant #3): a symlinked
//! history.jsonl is refused; an unparseable timestamp is ALWAYS retained in the
//! head (never trash freshly-typed prompts); a concurrent append aborts + retries
//! once; an oversized line aborts the prune (never a truncated rewrite).

use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, ErrorKind, Read, Write};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::Path;
use std::time::SystemTime;

use chrono::{DateTime, Local, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Caps one history.jsonl line; an oversized line aborts the scan (never a
/// silently-truncated rewrite) — mirrors `maxHistoryLine`.
const MAX_HISTORY_LINE: usize = 16 << 20;

/// One bucket of the history histogram. Mirrors `HistoryMonth`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryMonth {
    pub month: String, // "2006-01"
    pub lines: i64,
    pub bytes: i64,
}

/// Summarizes `<root>/history.jsonl` for the history panel. Mirrors
/// `HistoryStats`. `months` is `None` (JSON `null`) when empty — Go leaves the
/// slice nil rather than initialising it, unlike the health DTO's `[]`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryStats {
    pub total_lines: i64,
    pub bytes: i64,
    pub malformed: i64,
    pub oldest_ms: f64,
    pub newest_ms: f64,
    pub months: Option<Vec<HistoryMonth>>,
    pub prunable_lines: i64,
    pub prunable_bytes: i64,
}

/// Streams history.jsonl and reports a monthly histogram plus how much is
/// prunable against `cutoff`. Malformed lines are counted, never fatal. A
/// missing file is an empty (non-error) result. Mirrors `AnalyzeHistory`.
pub fn analyze_history(root: &str, cutoff: DateTime<Utc>) -> Result<HistoryStats, String> {
    let path = Path::new(root).join("history.jsonl");
    refuse_symlink_file(&path)?;

    let file = match File::open(&path) {
        Ok(f) => f,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(HistoryStats::default()),
        Err(e) => return Err(e.to_string()),
    };
    let mut reader = BufReader::new(file);

    let mut months: BTreeMap<String, HistoryMonth> = BTreeMap::new();
    let mut stats = HistoryStats::default();

    while let Some(line) = next_history_line(&mut reader)? {
        let n = (line.len() as i64) + 1;
        stats.total_lines += 1;
        stats.bytes += n;

        let Some(ms) = history_line_time(&line) else {
            stats.malformed += 1;
            continue;
        };
        let ms_f = ms as f64;
        if stats.oldest_ms == 0.0 || ms_f < stats.oldest_ms {
            stats.oldest_ms = ms_f;
        }
        if ms_f > stats.newest_ms {
            stats.newest_ms = ms_f;
        }
        // Month key formats in local time, mirroring Go's `time.UnixMilli`
        // (Local) + `Format("2006-01")`.
        if let Some(local) = Local.timestamp_millis_opt(ms).single() {
            let key = local.format("%Y-%m").to_string();
            let m = months
                .entry(key.clone())
                .or_insert_with(|| HistoryMonth { month: key, lines: 0, bytes: 0 });
            m.lines += 1;
            m.bytes += n;
        }
        // Prunable = strictly older than the cutoff (absolute-instant compare).
        if let Some(utc) = Utc.timestamp_millis_opt(ms).single() {
            if utc < cutoff {
                stats.prunable_lines += 1;
                stats.prunable_bytes += n;
            }
        }
    }

    if !months.is_empty() {
        stats.months = Some(months.into_values().collect()); // BTreeMap already key-sorted
    }
    Ok(stats)
}

/// Splits history.jsonl at `cutoff`, trashes the old tail (as valid JSONL) via
/// the injected `trash` closure, and atomically replaces the file with the
/// retained head. A line whose timestamp can't be parsed is ALWAYS retained. A
/// concurrent append aborts and retries once. `R` is the trash closure's receipt
/// type — history.rs never names the trash engine's `TrashReceipt`. Mirrors
/// `PruneHistory`.
pub fn prune_history<F, R>(
    app_data_dir: &str,
    history_path: &str,
    cutoff: DateTime<Utc>,
    trash: F,
) -> Result<R, String>
where
    F: Fn(&[String]) -> Result<R, String>,
{
    refuse_symlink_file(Path::new(history_path))?;
    let canon_app_data = resolve_app_data_dir(app_data_dir, true)?;

    for _attempt in 0..2 {
        let snap = stat_snapshot(history_path)?;
        let (head, tail) = split_history(history_path, cutoff)?;
        if tail.is_empty() {
            return Err("maintenance: nothing older than the cutoff to prune".to_string());
        }

        let tail_path =
            Path::new(&canon_app_data).join(format!("history-tail-{}.jsonl", Uuid::new_v4()));
        let tail_path_str = tail_path.to_string_lossy().into_owned();
        write_lines(&tail_path_str, &tail)?;

        let head_tmp = format!("{history_path}.tmp");
        if let Err(e) = write_lines(&head_tmp, &head) {
            let _ = fs::remove_file(&tail_path);
            let _ = fs::remove_file(&head_tmp);
            return Err(e);
        }

        // Final conflict check immediately before the destructive steps.
        match stat_snapshot(history_path) {
            Ok(cur) if cur == snap => {}
            _ => {
                let _ = fs::remove_file(&tail_path);
                let _ = fs::remove_file(&head_tmp);
                continue; // CLI appended mid-prune — discard and retry once
            }
        }

        // Trash the tail FIRST (so a rename failure can't lose it), then rename.
        let receipt = match trash(std::slice::from_ref(&tail_path_str)) {
            Ok(r) => r,
            Err(e) => {
                let _ = fs::remove_file(&tail_path);
                let _ = fs::remove_file(&head_tmp);
                return Err(format!("maintenance: preserve history tail: {e}"));
            }
        };
        if let Err(e) = fs::rename(&head_tmp, history_path) {
            let _ = fs::remove_file(&head_tmp);
            // Go returns (receipt, err) so the caller learns the tail is already
            // trashed; a Rust `Result` can't carry both — the tail is safely
            // trashed, so surface the error.
            return Err(format!("maintenance: replace history.jsonl: {e}"));
        }
        return Ok(receipt);
    }
    Err("maintenance: history.jsonl kept changing; prune aborted (no data lost)".to_string())
}

/// Reads history_path fresh and partitions lines into head (retained:
/// newer-than-cutoff OR unparseable timestamp) and tail (pruned: parseable AND
/// older than cutoff). Bytes are preserved per line. Mirrors `splitHistory`.
fn split_history(
    history_path: &str,
    cutoff: DateTime<Utc>,
) -> Result<(Vec<Vec<u8>>, Vec<Vec<u8>>), String> {
    let file = File::open(history_path).map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(file);
    let mut head: Vec<Vec<u8>> = Vec::new();
    let mut tail: Vec<Vec<u8>> = Vec::new();

    while let Some(line) = next_history_line(&mut reader)? {
        let is_prunable = match history_line_time(&line) {
            Some(ms) => Utc
                .timestamp_millis_opt(ms)
                .single()
                .map(|t| t < cutoff)
                .unwrap_or(false),
            None => false, // H2: unparseable stays in the head
        };
        if is_prunable {
            tail.push(line);
        } else {
            head.push(line);
        }
    }
    Ok((head, tail))
}

/// Extracts the epoch-ms timestamp from one history.jsonl line. Mirrors
/// `historyLineTime` — a missing/non-positive/unparseable timestamp is `None`.
fn history_line_time(line: &[u8]) -> Option<i64> {
    #[derive(Deserialize)]
    struct Entry {
        #[serde(default)]
        timestamp: f64,
    }
    let entry: Entry = serde_json::from_slice(line).ok()?;
    if entry.timestamp <= 0.0 {
        return None;
    }
    Some(entry.timestamp as i64) // truncate toward zero, like Go's int64()
}

/// Reads the next line capped at `MAX_HISTORY_LINE` bytes; an oversized line is
/// an error (abort), never a truncated read. Strips a trailing `\n` (and a
/// preceding `\r`) like `bufio.ScanLines`. `None` = EOF.
fn next_history_line<R: BufRead>(reader: &mut R) -> Result<Option<Vec<u8>>, String> {
    let mut buf = Vec::new();
    let n = reader
        .by_ref()
        .take((MAX_HISTORY_LINE as u64) + 1)
        .read_until(b'\n', &mut buf)
        .map_err(|e| format!("maintenance: scan history: {e}"))?;
    if n == 0 {
        return Ok(None);
    }
    if buf.last() == Some(&b'\n') {
        buf.pop();
        if buf.last() == Some(&b'\r') {
            buf.pop();
        }
    }
    if buf.len() > MAX_HISTORY_LINE {
        return Err("maintenance: scan history: line exceeds maximum length".to_string());
    }
    Ok(Some(buf))
}

/// Writes each line + "\n" to path at 0600 (prompt history / secrets). Mirrors
/// `writeLines` (fsync before close).
fn write_lines(path: &str, lines: &[Vec<u8>]) -> Result<(), String> {
    let mut f = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .mode(0o600)
        .open(path)
        .map_err(|e| e.to_string())?;
    for line in lines {
        f.write_all(line).map_err(|e| e.to_string())?;
        f.write_all(b"\n").map_err(|e| e.to_string())?;
    }
    f.flush().map_err(|e| e.to_string())?;
    f.sync_all().map_err(|e| e.to_string())?;
    Ok(())
}

/// Size + mtime snapshot used to detect a concurrent append. Mirrors
/// `historySnapshot`/`statSnapshot`.
#[derive(PartialEq)]
struct HistorySnapshot {
    size: u64,
    modified: SystemTime,
}

fn stat_snapshot(path: &str) -> Result<HistorySnapshot, String> {
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    let modified = meta.modified().map_err(|e| e.to_string())?;
    Ok(HistorySnapshot {
        size: meta.len(),
        modified,
    })
}

/// Errors if path is a symlink (never read/rewrite through a planted symlink).
/// A missing path is not an error. Mirrors `refuseSymlinkFile`.
fn refuse_symlink_file(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            if meta.file_type().is_symlink() {
                return Err(format!(
                    "maintenance: {:?} is a symlink; refusing",
                    path.to_string_lossy()
                ));
            }
            Ok(())
        }
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Optionally creates app_data_dir (0755) then canonicalizes it. Mirrors
/// `resolveAppDataDir` (kept local to avoid importing the trash engine).
fn resolve_app_data_dir(app_data_dir: &str, create: bool) -> Result<String, String> {
    if create {
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o755)
            .create(app_data_dir)
            .map_err(|e| format!("maintenance: create app-data dir: {e}"))?;
    }
    let canon = fs::canonicalize(app_data_dir)
        .map_err(|e| format!("maintenance: app-data dir {app_data_dir:?} does not resolve: {e}"))?;
    Ok(canon.to_string_lossy().into_owned())
}

#[cfg(test)]
#[path = "history_tests.rs"]
mod history_tests;
