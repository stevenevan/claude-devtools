//! System service — ports the Go oracle `internal/systemservice/service.go`
//! (the pure, non-legacy parts): app version, open-path command builder, todo
//! aggregation, and plugin discovery. No Tauri import — main.rs wires commands.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::discovery::path_decoder;

const MAX_RENDERER_LOG_MESSAGE_BYTES: usize = 2048;
const MAX_RENDERER_LOG_CONTEXT_BYTES: usize = 8192;
const MAX_RENDERER_LOG_CONTEXT_DEPTH: usize = 8;

static RENDERER_LOG_CREDENTIALS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?ix)
            \b(?:bearer|basic)\s+[a-z0-9._~+/=-]+ |
            \b(?:sk-[a-z0-9_-]{16,}|gh[ps]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[a-z0-9-]+)\b |
            https?://(?:hooks\.slack\.com/services|discord(?:app)?\.com/api/webhooks)/[^\s"']+
        "#,
    )
    .expect("renderer log credential regex must compile")
});

fn redact_renderer_log_string(value: &str) -> String {
    RENDERER_LOG_CREDENTIALS
        .replace_all(value, "<REDACTED>")
        .into_owned()
}

fn redact_renderer_log_context(value: &Value, depth: usize) -> Result<Value, String> {
    if depth > MAX_RENDERER_LOG_CONTEXT_DEPTH {
        return Err("renderer log context exceeds maximum depth".to_string());
    }

    let masked = crate::files::claudejson::mask_json_value("", value);
    match masked {
        Value::Array(values) => values
            .iter()
            .map(|item| redact_renderer_log_context(item, depth + 1))
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array),
        Value::Object(values) => values
            .iter()
            .map(|(key, item)| {
                redact_renderer_log_context(item, depth + 1).map(|item| (key.clone(), item))
            })
            .collect::<Result<serde_json::Map<String, Value>, _>>()
            .map(Value::Object),
        Value::String(value) => Ok(Value::String(redact_renderer_log_string(&value))),
        other => Ok(other),
    }
}

/// Validates and redacts untrusted renderer telemetry before writing structured stderr.
pub fn log_renderer_event(level: &str, message: &str, context: &Value) -> Result<(), String> {
    if !matches!(level, "error" | "warn" | "info" | "debug") {
        return Err("invalid renderer log level".to_string());
    }
    if message.len() > MAX_RENDERER_LOG_MESSAGE_BYTES {
        return Err("renderer log message exceeds maximum size".to_string());
    }

    let context = redact_renderer_log_context(context, 0)?;
    let context_json = serde_json::to_string(&context)
        .map_err(|_| "renderer log context could not be serialized".to_string())?;
    if context_json.len() > MAX_RENDERER_LOG_CONTEXT_BYTES {
        return Err("renderer log context exceeds maximum size".to_string());
    }

    let entry = serde_json::json!({
        "target": "renderer",
        "level": level,
        "message": redact_renderer_log_string(message),
        "context": context,
    });
    eprintln!("{entry}");
    Ok(())
}

// ─── app version ─────────────────────────────────────────────────────────────

/// Mirrors Go `systemservice.appVersion` (`service.go:28`) — the literal "0.1.0".
/// The Go const has drifted from Cargo.toml (0.4.8); byte-match Go, do NOT use
/// `env!(CARGO_PKG_VERSION)`.
pub fn app_version() -> &'static str {
    "0.1.0"
}

// ─── open path ───────────────────────────────────────────────────────────────

/// Mirrors Go `openPathCmd` — builds the OS file-manager command as ARGV
/// (`Command::new(prog).arg(target)`), NEVER `sh -c` (guard rail).
pub fn open_path_cmd(target: &str) -> Command {
    let program = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(target_os = "windows") {
        "explorer"
    } else {
        "xdg-open"
    };
    let mut cmd = Command::new(program);
    cmd.arg(target);
    cmd
}

// ─── todos aggregation ───────────────────────────────────────────────────────

/// Mirrors Go `AggregatedSessionTodos`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AggregatedSessionTodos {
    pub project_id: String,
    pub session_id: String,
    pub updated_at: f64,
    pub items: serde_json::Value,
}

/// Mirrors Go `GetAllTodos` — aggregates `~/.claude/todos/*.json` per project,
/// sorted by `updatedAt` descending.
///
/// Reconciliation notes vs Go:
///   - claude dir: Go's `GetAllTodos` uses `os.UserHomeDir()` (NOT CLAUDE_ROOT),
///     so we use `dirs::home_dir()/.claude` — not `watcher::resolve_claude_dir`.
///   - `updatedAt`: Go uses `info.ModTime().UnixMilli()` (integer ms); we use
///     `duration.as_millis() as f64` to match (the old Rust used fractional ms).
///   - validation/base-dir: the canonical `discovery::path_decoder` helpers (the
///     original source of Go's inlined check).
pub fn get_all_todos(project_ids: Vec<String>) -> Result<Vec<AggregatedSessionTodos>, String> {
    let home = dirs::home_dir().ok_or("cannot resolve home directory")?;
    let claude_dir = home.join(".claude");
    let projects_dir = path_decoder::get_projects_base_path(&claude_dir);
    let todos_dir = claude_dir.join("todos");
    let mut out: Vec<AggregatedSessionTodos> = Vec::new();

    for project_id in &project_ids {
        if !path_decoder::is_valid_project_id(project_id) {
            continue;
        }
        let base_id = path_decoder::extract_base_dir(project_id);
        let project_dir = projects_dir.join(base_id);
        let entries = match std::fs::read_dir(&project_dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let fname = entry.file_name();
            let fname = fname.to_string_lossy();
            if !fname.ends_with(".jsonl") {
                continue;
            }
            let session_id = fname.trim_end_matches(".jsonl").to_string();
            let todo_path = todos_dir.join(format!("{session_id}.json"));
            if !todo_path.exists() {
                continue;
            }
            let content = match std::fs::read_to_string(&todo_path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let items: serde_json::Value = match serde_json::from_str(&content) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let updated_at = std::fs::metadata(&todo_path)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as f64)
                .unwrap_or(0.0);
            out.push(AggregatedSessionTodos {
                project_id: project_id.clone(),
                session_id,
                updated_at,
                items,
            });
        }
    }

    out.sort_by(|a, b| {
        b.updated_at
            .partial_cmp(&a.updated_at)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(out)
}

// ─── plugin discovery ────────────────────────────────────────────────────────

/// Mirrors Go `PluginEntry`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginEntry {
    pub id: String,
    pub path: String,
}

const PLUGINS_DIR_ENV: &str = "CLAUDE_DEVTOOLS_PLUGINS_DIR";

fn plugins_dir() -> Result<PathBuf, String> {
    // Go treats an empty env var as unset (`override != ""`); match that.
    if let Ok(override_path) = std::env::var(PLUGINS_DIR_ENV) {
        if !override_path.is_empty() {
            return Ok(PathBuf::from(override_path));
        }
    }
    let home = dirs::home_dir().ok_or_else(|| "cannot resolve home directory".to_string())?;
    Ok(home.join(".claude-devtools").join("plugins"))
}

/// Mirrors Go `PluginsDiscover` — enumerates `*.js` in the plugins dir, sorted by id.
pub fn plugins_discover() -> Result<Vec<PluginEntry>, String> {
    let dir = plugins_dir()?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    Ok(discover_plugins(&dir))
}

fn discover_plugins(dir: &Path) -> Vec<PluginEntry> {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.ends_with(".js") {
            continue;
        }
        let id = name[..name.len() - 3].to_string();
        out.push(PluginEntry {
            id,
            path: entry.path().to_string_lossy().to_string(),
        });
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_version_matches_go_const() {
        assert_eq!(app_version(), "0.1.0");
    }

    // GOLDEN: open_path_cmd argv per target OS — inspect, do NOT spawn.
    #[test]
    fn open_path_cmd_argv_per_os() {
        let cmd = open_path_cmd("/Users/test/Documents");
        let program = cmd.get_program().to_string_lossy().to_string();
        let expected = if cfg!(target_os = "macos") {
            "open"
        } else if cfg!(target_os = "windows") {
            "explorer"
        } else {
            "xdg-open"
        };
        assert_eq!(program, expected);
        let args: Vec<String> = cmd
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert_eq!(args, vec!["/Users/test/Documents".to_string()]);
    }

    #[test]
    fn discover_only_js_files_sorted() {
        let tmp = std::env::temp_dir().join(format!("plugins-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        std::fs::write(tmp.join("zed.js"), "// noop").unwrap();
        std::fs::write(tmp.join("hello.js"), "// noop").unwrap();
        std::fs::write(tmp.join("ignored.txt"), "skip").unwrap();
        std::fs::write(tmp.join("README.md"), "skip").unwrap();
        std::fs::create_dir_all(tmp.join("subdir")).unwrap();

        let found = discover_plugins(&tmp);
        let ids: Vec<&str> = found.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, vec!["hello", "zed"]);

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn missing_dir_returns_empty() {
        let tmp = std::env::temp_dir().join(format!("plugins-missing-{}", uuid::Uuid::new_v4()));
        assert!(discover_plugins(&tmp).is_empty());
    }

    #[test]
    fn renderer_log_rejects_invalid_level() {
        let error = log_renderer_event("trace", "message", &serde_json::json!({})).unwrap_err();
        assert_eq!(error, "invalid renderer log level");
    }

    #[test]
    fn renderer_log_rejects_oversized_or_deep_input() {
        assert!(log_renderer_event(
            "info",
            &"x".repeat(MAX_RENDERER_LOG_MESSAGE_BYTES + 1),
            &serde_json::json!({}),
        )
        .is_err());

        let mut context = serde_json::json!("leaf");
        for _ in 0..=MAX_RENDERER_LOG_CONTEXT_DEPTH {
            context = serde_json::json!({ "child": context });
        }
        assert!(log_renderer_event("info", "message", &context).is_err());
    }

    #[test]
    fn renderer_log_redacts_secret_values() {
        let context = serde_json::json!({
            "token": "AKIA1234567890ABCDEF",
            "webhook": "https://hooks.slack.com/services/T000/B000/secret",
        });
        let redacted = redact_renderer_log_context(&context, 0).unwrap();
        let rendered = serde_json::to_string(&redacted).unwrap();
        assert!(!rendered.contains("AKIA1234567890ABCDEF"));
        assert!(!rendered.contains("hooks.slack.com"));
        assert!(rendered.contains("<REDACTED>"));
    }
}
