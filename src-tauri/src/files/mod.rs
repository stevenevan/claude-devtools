//! `files` — the `internal/files` write-safety spine ported to Rust (W12).
//! Per-family mutex, read-fresh-under-lock, atomic temp+rename, `.bak` backups,
//! parent-path (never leaf) confinement, secret masking. Guards reproduced
//! guard-for-guard; error sentinels are byte-identical (the frontend matches
//! them literally). See `pathutil::confine`.

pub mod agents_write;
pub mod claude_read;
pub mod claudejson;
pub mod claudejson_write;
pub mod fsutil;
pub mod hooks_write;
pub mod json_util;
pub mod mcp_status;
pub mod memory;
pub mod memory_write;
pub mod pathutil;
pub mod permissions_write;
pub mod plugins_write;
pub mod secret_export;
pub mod settings_generations;
pub mod settings_sources;
pub mod settings_write;
pub mod skills_inventory;
pub mod text_write;

// One process-wide lock shared by every test that redirects `$HOME` /
// `CLAUDE_DEVTOOLS_DIR` (settings/claudejson/hooks families resolve paths off
// the global env). Per-module locks would race across modules under the
// parallel test runner. All home-redirecting test guards acquire THIS lock.
#[cfg(test)]
pub(crate) static TEST_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
