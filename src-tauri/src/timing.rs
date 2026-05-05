//! Backend timings ring buffer (sprint 46).
//!
//! Captures per-command execution durations into a fixed-size ring
//! buffer the renderer can poll for p50/p95/p99 stats. The buffer is
//! `Mutex<VecDeque>` keyed nowhere — tags carry the command name —
//! and overwrites the oldest entry when capacity is reached.

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::Instant;

use serde::Serialize;

const BUFFER_CAPACITY: usize = 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimingEntry {
    pub command: String,
    pub duration_ms: f64,
    pub at_unix_ms: f64,
}

pub struct TimingBuffer {
    entries: Mutex<VecDeque<TimingEntry>>,
    capacity: usize,
}

impl TimingBuffer {
    pub fn new(capacity: usize) -> Self {
        Self {
            entries: Mutex::new(VecDeque::with_capacity(capacity)),
            capacity,
        }
    }

    pub fn record(&self, command: impl Into<String>, duration_ms: f64) {
        let entry = TimingEntry {
            command: command.into(),
            duration_ms,
            at_unix_ms: now_unix_ms(),
        };
        let mut buf = match self.entries.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        if buf.len() >= self.capacity {
            buf.pop_front();
        }
        buf.push_back(entry);
    }

    pub fn snapshot(&self, limit: Option<usize>) -> Vec<TimingEntry> {
        let buf = match self.entries.lock() {
            Ok(g) => g,
            Err(_) => return Vec::new(),
        };
        let take = limit.unwrap_or(usize::MAX);
        buf.iter().rev().take(take).cloned().collect()
    }

    pub fn clear(&self) {
        if let Ok(mut buf) = self.entries.lock() {
            buf.clear();
        }
    }
}

impl Default for TimingBuffer {
    fn default() -> Self {
        Self::new(BUFFER_CAPACITY)
    }
}

fn now_unix_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

/// RAII guard — records elapsed wall time on drop. Use:
/// `let _g = TimingGuard::new(&buf, "get_session_detail");`
pub struct TimingGuard<'a> {
    buffer: &'a TimingBuffer,
    command: &'a str,
    started: Instant,
}

impl<'a> TimingGuard<'a> {
    pub fn new(buffer: &'a TimingBuffer, command: &'a str) -> Self {
        Self {
            buffer,
            command,
            started: Instant::now(),
        }
    }
}

impl<'a> Drop for TimingGuard<'a> {
    fn drop(&mut self) {
        let elapsed_ms = self.started.elapsed().as_secs_f64() * 1000.0;
        self.buffer.record(self.command, elapsed_ms);
    }
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PercentileSummary {
    pub command: String,
    pub count: u32,
    pub p50_ms: f64,
    pub p95_ms: f64,
    pub p99_ms: f64,
    pub max_ms: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    pub capacity: usize,
    pub size: usize,
    pub hits: u64,
    pub misses: u64,
    pub evicts: u64,
    pub hit_rate: f64,
}

#[tauri::command]
pub fn get_backend_timings(
    limit: Option<usize>,
    timing: tauri::State<'_, std::sync::Arc<TimingBuffer>>,
) -> Result<Vec<PercentileSummary>, String> {
    let entries = timing.snapshot(None);
    let limited: Vec<TimingEntry> = match limit {
        Some(n) => entries.into_iter().take(n).collect(),
        None => entries,
    };
    Ok(summarize(&limited))
}

#[tauri::command]
pub fn get_cache_stats(
    cache: tauri::State<'_, std::sync::Arc<std::sync::Mutex<crate::cache::SessionCache>>>,
) -> Result<CacheStats, String> {
    let guard = cache.lock().map_err(|e| e.to_string())?;
    let total = guard.hits + guard.misses;
    let hit_rate = if total == 0 { 0.0 } else { guard.hits as f64 / total as f64 };
    Ok(CacheStats {
        capacity: guard.capacity(),
        size: guard.len(),
        hits: guard.hits,
        misses: guard.misses,
        evicts: guard.evicts,
        hit_rate,
    })
}

#[tauri::command]
pub fn set_cache_capacity(
    capacity: usize,
    cache: tauri::State<'_, std::sync::Arc<std::sync::Mutex<crate::cache::SessionCache>>>,
) -> Result<(), String> {
    let mut guard = cache.lock().map_err(|e| e.to_string())?;
    guard.set_capacity(capacity);
    Ok(())
}

#[tauri::command]
pub fn clear_session_cache(
    cache: tauri::State<'_, std::sync::Arc<std::sync::Mutex<crate::cache::SessionCache>>>,
) -> Result<(), String> {
    let mut guard = cache.lock().map_err(|e| e.to_string())?;
    guard.clear();
    Ok(())
}

/// Group entries by command and compute summary percentiles.
pub fn summarize(entries: &[TimingEntry]) -> Vec<PercentileSummary> {
    use std::collections::BTreeMap;
    let mut grouped: BTreeMap<String, Vec<f64>> = BTreeMap::new();
    for e in entries {
        grouped.entry(e.command.clone()).or_default().push(e.duration_ms);
    }
    let mut out = Vec::new();
    for (command, mut samples) in grouped {
        samples.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let n = samples.len();
        if n == 0 {
            continue;
        }
        let pct = |q: f64| -> f64 {
            let idx = ((n as f64 - 1.0) * q).round() as usize;
            samples[idx.min(n - 1)]
        };
        out.push(PercentileSummary {
            command,
            count: n as u32,
            p50_ms: pct(0.5),
            p95_ms: pct(0.95),
            p99_ms: pct(0.99),
            max_ms: samples[n - 1],
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_buffer_overwrites_at_capacity() {
        let buf = TimingBuffer::new(3);
        buf.record("a", 1.0);
        buf.record("b", 2.0);
        buf.record("c", 3.0);
        buf.record("d", 4.0); // pushes "a" out
        let snap = buf.snapshot(None);
        let cmds: Vec<&str> = snap.iter().map(|e| e.command.as_str()).collect();
        // snapshot is newest-first
        assert_eq!(cmds, vec!["d", "c", "b"]);
    }

    #[test]
    fn percentile_summary_basic() {
        let entries = vec![
            TimingEntry { command: "x".into(), duration_ms: 10.0, at_unix_ms: 0.0 },
            TimingEntry { command: "x".into(), duration_ms: 20.0, at_unix_ms: 0.0 },
            TimingEntry { command: "x".into(), duration_ms: 30.0, at_unix_ms: 0.0 },
            TimingEntry { command: "x".into(), duration_ms: 40.0, at_unix_ms: 0.0 },
            TimingEntry { command: "x".into(), duration_ms: 50.0, at_unix_ms: 0.0 },
        ];
        let summary = summarize(&entries);
        assert_eq!(summary.len(), 1);
        assert_eq!(summary[0].count, 5);
        assert_eq!(summary[0].max_ms, 50.0);
        assert_eq!(summary[0].p50_ms, 30.0);
    }

    #[test]
    fn timing_guard_records_on_drop() {
        let buf = TimingBuffer::new(10);
        {
            let _g = TimingGuard::new(&buf, "fast");
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        let snap = buf.snapshot(None);
        assert_eq!(snap.len(), 1);
        assert_eq!(snap[0].command, "fast");
        assert!(snap[0].duration_ms >= 1.0);
    }
}
