//! Reads the CLI's own `stats-cache.json` for the read-only Usage viewer
//! (sprint 06). No confinement needed: this is a fixed top-level filename
//! under `~/.claude`, not untrusted input, so it does not go through
//! `claude_read::read_confined_file`.

use std::fs;
use std::path::Path;

/// Reads and parses `<root>/stats-cache.json`. Missing file → `Ok(Value::Null)`
/// (tolerant). Returns the raw object as-is (tolerant of missing keys).
// confirm-at-impl: key set current 2026-07.
pub fn read_usage_stats(root: &str) -> Result<serde_json::Value, String> {
    let path = Path::new(root).join("stats-cache.json");
    if !path.exists() {
        return Ok(serde_json::Value::Null);
    }
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "usage_reader_tests.rs"]
mod usage_reader_tests;
