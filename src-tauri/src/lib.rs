//! claude_devtools_lib — the Rust backend shared by the Tauri app (`main.rs`) and
//! the read-only CLI twin (`bin/cli.rs`, W7). Ported week-by-week from the Go
//! backend under `internal/*`, kept byte-parity with the Go `cmd/cli` oracle.
//!
//! Cycle B builds this out: W3 types + config-root + path decode (below); W4
//! parsing; W5 analysis; W6 discovery + cache; W7 search + pipeline + CLI twin.

pub mod analysis;
pub mod analytics;
pub mod cache;
pub mod commands;
pub mod config;
pub mod configbackup;
pub mod discovery;
pub mod files;
pub mod insights;
pub mod maintenance;
pub mod notifications;
pub mod nl_query;
pub mod parsing;
pub mod pipeline;
pub mod snapshots;
pub mod ssh;
pub mod system;
pub mod time_util;
pub mod timing;
pub mod tokenizer;
pub mod types;
pub mod watcher;

#[cfg(test)]
pub mod testutil;
