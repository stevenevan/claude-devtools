//! The `statusLine` object in `~/.claude/settings.json` — the status bar Claude
//! Code renders by SHELL-EXECUTING `command` on every refresh.
//!
//! Schema per https://code.claude.com/docs/en/statusline: `type` ("command"),
//! `command`, and the optional `padding` / `refreshInterval` /
//! `hideVimModeIndicator`. Disabling is deleting the key, not writing a
//! falsy value.
//!
//! Writes route through `settings_write::mutate_settings_json` — the single
//! settings.json writer (lock, read-fresh, `.bak`, temp+rename). Nothing here
//! ever executes `command`; this module only reads and persists it.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::files::settings_write::{mutate_settings_json, read_global_settings};

/// The `statusLine` object. `extra` is load-bearing: serde drops unknown fields
/// on deserialize, so without it a save would silently delete any sub-key this
/// struct does not model — a field a future Claude Code release adds, or one
/// the user hand-set. `mutate_settings_json` preserves other TOP-LEVEL keys,
/// but nothing else preserves keys inside the object being replaced.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusLineConfig {
    pub r#type: String,
    pub command: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub padding: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh_interval: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hide_vim_mode_indicator: Option<bool>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// Reads the `statusLine` object. A missing key is `Ok(None)`. A key that is
/// present but malformed is an `Err` — NOT `Ok(None)`. The tolerant-parser
/// convention is for read-only viewers of drifting formats; on this
/// read-modify-write path, rendering an empty form and then saving over the
/// user's value would turn "display nothing" into "delete their data".
pub fn read_status_line() -> Result<Option<StatusLineConfig>, String> {
    let settings = read_global_settings()?;
    let Some(raw) = settings.get("statusLine") else {
        return Ok(None);
    };
    if raw.is_null() {
        return Ok(None);
    }
    serde_json::from_value(raw.clone())
        .map(Some)
        .map_err(|e| format!("files: parse statusLine: {e}"))
}

/// `pub(crate)` so the command layer runs it at the IPC boundary, per CLAUDE.md,
/// before the value reaches the writer.
pub(crate) fn validate(cfg: &StatusLineConfig) -> Result<(), String> {
    if cfg.r#type != "command" {
        return Err(format!(
            "files: invalid statusLine type {:?}: only \"command\" is supported",
            cfg.r#type
        ));
    }
    if cfg.command.trim().is_empty() {
        return Err("files: statusLine command must not be empty".to_string());
    }
    if let Some(interval) = cfg.refresh_interval {
        if interval < 1 {
            return Err("files: statusLine refreshInterval must be >= 1".to_string());
        }
    }
    Ok(())
}

/// Writes the `statusLine` key, or removes it when `cfg` is `None` (the
/// documented way to disable the status line). Touches no other key.
pub fn write_status_line(cfg: Option<StatusLineConfig>) -> Result<(), String> {
    if let Some(c) = &cfg {
        validate(c)?;
    }
    mutate_settings_json(move |m| {
        match &cfg {
            Some(c) => {
                let value = serde_json::to_value(c)
                    .map_err(|e| format!("files: marshal statusLine: {e}"))?;
                m.insert("statusLine".to_string(), value);
            }
            None => {
                m.remove("statusLine");
            }
        }
        Ok(())
    })
}

/// What the UI can say about the script `command` points at, without reading
/// its content or running it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusLineScriptInfo {
    pub resolved_path: Option<String>,
    pub exists: bool,
    pub size_bytes: u64,
    pub is_text: bool,
    pub under_claude_root: bool,
}

const PATH_EXTRA_CHARS: &str = "._-/~+@";

/// Decides whether `command` is a plain path or an inline shell command.
///
/// This is a HEURISTIC, not a security control: nothing in this module passes
/// `command` to a shell (stat uses `fs::metadata`, reveal uses the platform
/// file-manager API), so there is no injection sink to guard. A mis-parse costs
/// at worst a stat of a path that does not exist. Do not let later code treat
/// it as a boundary.
///
/// Allowlist rather than denylist — same size, no by-construction gaps. Must
/// contain `/` or start with `~/`: a bare token like `jq` would otherwise
/// classify as a path and resolve against the process's arbitrary CWD.
fn resolve_command_path(command: &str, root: &Path) -> Option<PathBuf> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return None;
    }
    if !trimmed
        .chars()
        .all(|c| c.is_alphanumeric() || PATH_EXTRA_CHARS.contains(c))
    {
        return None;
    }

    if let Some(rest) = trimmed.strip_prefix("~/") {
        // The claude root is `$HOME/.claude`, so its parent is the home dir.
        // Derived from the root rather than resolving the home directory
        // directly, which would add a new site to the QA gate-3 baseline.
        // A configurable root of "/" has no parent — return None, never unwrap.
        let home = root.parent()?;
        return Some(home.join(rest));
    }
    if !trimmed.contains('/') {
        return None;
    }
    Some(PathBuf::from(trimmed))
}

/// Sniff cap: enough to classify text vs binary, small enough that the 2.8 MB
/// Mach-O a real `status-line` can be is never loaded.
const SNIFF_BYTES: usize = 4096;

fn sniff_is_text(path: &Path, size: u64) -> bool {
    let Ok(bytes) = fs::read(path) else {
        return false;
    };
    let cap = SNIFF_BYTES.min(size as usize).min(bytes.len());
    let head = &bytes[..cap];
    if head.contains(&0) {
        return false;
    }
    match std::str::from_utf8(head) {
        Ok(_) => true,
        // A truncated multi-byte char at the cap is still text.
        Err(e) => e.valid_up_to() + 4 > head.len(),
    }
}

/// Metadata only — never returns file content, so an arbitrary path yields at
/// most a size and a text/binary bit.
pub fn stat_status_line_script(command: &str, root: &Path) -> StatusLineScriptInfo {
    let Some(path) = resolve_command_path(command, root) else {
        return StatusLineScriptInfo {
            resolved_path: None,
            exists: false,
            size_bytes: 0,
            is_text: false,
            under_claude_root: false,
        };
    };

    let resolved_path = Some(path.to_string_lossy().into_owned());
    let Ok(meta) = fs::metadata(&path) else {
        return StatusLineScriptInfo {
            resolved_path,
            exists: false,
            size_bytes: 0,
            is_text: false,
            under_claude_root: false,
        };
    };
    if !meta.is_file() {
        return StatusLineScriptInfo {
            resolved_path,
            exists: false,
            size_bytes: 0,
            is_text: false,
            under_claude_root: false,
        };
    }

    let under_claude_root = match (fs::canonicalize(&path), fs::canonicalize(root)) {
        (Ok(p), Ok(r)) => p.starts_with(&r),
        _ => false,
    };

    StatusLineScriptInfo {
        resolved_path,
        exists: true,
        size_bytes: meta.len(),
        is_text: sniff_is_text(&path, meta.len()),
        under_claude_root,
    }
}

/// Reveals the script in the OS file manager. NEVER opens/executes it: on macOS
/// `open <mach-o>` would RUN the binary, and a real `status-line` is one.
/// `reveal_item_in_dir` uses `NSWorkspace::activateFileViewerSelectingURLs`
/// (macOS) / the FileManager1 D-Bus interface (Linux) — no shell, no exec.
pub fn reveal_status_line_script(command: &str, root: &Path) -> Result<(), String> {
    let path = resolve_command_path(command, root)
        .ok_or_else(|| "files: statusLine command is not a file path".to_string())?;
    let meta = fs::metadata(&path).map_err(|e| format!("files: statusLine script: {e}"))?;
    if !meta.is_file() {
        return Err("files: statusLine script is not a regular file".to_string());
    }
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| format!("files: reveal: {e}"))
}

#[cfg(test)]
#[path = "statusline_tests.rs"]
mod statusline_tests;
