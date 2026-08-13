//! Claude-root + app-data path resolution (W3 subset of `internal/config`).
//!
//! Security asymmetry, preserved from Go: the configurable `claude_root_path`
//! is an APP-path resolver only and is intentionally unconfined
//! (`normalize_claude_root_path` accepts "/"). The CLI twin and any path
//! confinement guard anchor to `dirs::home_dir()/.claude` and MUST NOT consult
//! the config root — see `cmd/cli/main.go`, which never reads config.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

use crate::types::source::{
    SourceCapabilities, SourceKind, SourceState, SourceStatus, TaskGraphCapability,
};

const APP_DATA_DIR_ENV: &str = "CLAUDE_DEVTOOLS_DIR";
const CODEX_HOME_ENV: &str = "CODEX_HOME";

/// Mirrors `config/appdata.go:AppDataDir`. `$CLAUDE_DEVTOOLS_DIR` (must be
/// absolute) if set, else `$HOME/.claude-devtools`.
pub fn app_data_dir() -> Result<PathBuf, String> {
    if let Ok(override_dir) = std::env::var(APP_DATA_DIR_ENV) {
        if !override_dir.is_empty() {
            let p = PathBuf::from(&override_dir);
            if !p.is_absolute() {
                return Err(format!(
                    "{APP_DATA_DIR_ENV} must be an absolute path, got {override_dir:?}"
                ));
            }
            return Ok(p);
        }
    }
    Ok(home_dir()?.join(".claude-devtools"))
}

/// Mirrors `discovery/path_decoder.go:ClaudeDir` — `~/.claude`.
pub fn claude_dir() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".claude"))
}

/// Mirrors `discovery/path_decoder.go:ProjectsDir` — `~/.claude/projects`.
pub fn projects_dir() -> Result<PathBuf, String> {
    Ok(claude_dir()?.join("projects"))
}

/// Resolves the current Codex data root. An explicitly configured
/// `CODEX_HOME` is required to be absolute; an invalid explicit value is an
/// error rather than a silent fallback to another directory.
pub fn codex_dir() -> Result<PathBuf, String> {
    let home = home_dir()?;
    let configured = std::env::var_os(CODEX_HOME_ENV)
        .map(|value| value.to_string_lossy().into_owned());
    resolve_codex_dir(configured.as_deref(), &home)
}

pub fn resolve_codex_dir(configured: Option<&str>, home: &Path) -> Result<PathBuf, String> {
    let configured = configured.map(str::trim).filter(|value| !value.is_empty());
    match configured {
        Some(path) if !Path::new(path).is_absolute() => {
            Err(format!("{CODEX_HOME_ENV} must be an absolute path"))
        }
        Some(path) => Ok(PathBuf::from(path)),
        None => Ok(home.join(".codex")),
    }
}

/// Returns a renderer-safe status without exposing an absolute local path.
pub fn get_codex_source_status() -> SourceStatus {
    let configured = std::env::var_os(CODEX_HOME_ENV)
        .map(|value| value.to_string_lossy().into_owned());
    let label = if configured
        .as_deref()
        .map(str::trim)
        .is_some_and(|value| !value.is_empty())
    {
        CODEX_HOME_ENV.to_string()
    } else {
        "~/.codex".to_string()
    };
    let capabilities = SourceCapabilities {
        sessions: true,
        transcripts: true,
        task_graph: TaskGraphCapability::unsupported(
            "Codex does not expose the Claude Task Graph format",
        ),
    };

    let home = match home_dir() {
        Ok(home) => home,
        Err(reason) => {
            return SourceStatus {
                source_kind: SourceKind::Codex,
                state: SourceState::Invalid,
                label,
                revision: None,
                reason: Some(reason),
                capabilities,
            }
        }
    };
    let path = match resolve_codex_dir(configured.as_deref(), &home) {
        Ok(path) => path,
        Err(reason) => {
            return SourceStatus {
                source_kind: SourceKind::Codex,
                state: SourceState::Invalid,
                label,
                revision: None,
                reason: Some(reason),
                capabilities,
            }
        }
    };
    let metadata = match std::fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return SourceStatus {
                source_kind: SourceKind::Codex,
                state: SourceState::NotFound,
                label,
                revision: None,
                reason: Some("Codex data directory was not found".to_string()),
                capabilities,
            }
        }
        Err(error) => {
            return SourceStatus {
                source_kind: SourceKind::Codex,
                state: SourceState::Unreadable,
                label,
                revision: None,
                reason: Some(format!("cannot inspect Codex data directory: {error}")),
                capabilities,
            }
        }
    };
    if !metadata.is_dir() {
        return SourceStatus {
            source_kind: SourceKind::Codex,
            state: SourceState::Invalid,
            label,
            revision: None,
            reason: Some("Codex data root is not a directory".to_string()),
            capabilities,
        };
    }
    if let Err(error) = std::fs::read_dir(&path) {
        return SourceStatus {
            source_kind: SourceKind::Codex,
            state: SourceState::Unreadable,
            label,
            revision: None,
            reason: Some(format!("cannot read Codex data directory: {error}")),
            capabilities,
        };
    }

    SourceStatus {
        source_kind: SourceKind::Codex,
        state: SourceState::Available,
        label,
        revision: source_revision(&path),
        reason: None,
        capabilities,
    }
}

pub fn source_revision(root: &Path) -> Option<String> {
    let mut hasher = DefaultHasher::new();
    root.to_string_lossy().hash(&mut hasher);
    for name in [
        "history.jsonl",
        "session_index.jsonl",
        "sessions",
        "archived_sessions",
    ] {
        let path = root.join(name);
        name.hash(&mut hasher);
        match std::fs::metadata(path) {
            Ok(metadata) => {
                metadata.len().hash(&mut hasher);
                metadata.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok()).map(|modified| {
                    modified.as_nanos().hash(&mut hasher);
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                0_u8.hash(&mut hasher);
            }
            Err(_) => 1_u8.hash(&mut hasher),
        }
    }
    Some(format!("{:016x}", hasher.finish()))
}

fn home_dir() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "cannot resolve home directory".to_string())
}

/// Mirrors `internal/config/types.go:ClaudeRootInfo`. `configured_path` has no
/// skip_serializing_if → serializes as `null` when absent.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeRootInfo {
    pub default_path: String,
    pub configured_path: Option<String>,
    pub effective_path: String,
}

/// Mirrors `manager.go:GetClaudeRootInfo`. Pure over the configured override
/// (reading it from the config file is Cycle D). `configured` is expected to be
/// already normalized (see `normalize_claude_root_path`).
pub fn get_claude_root_info(configured: Option<String>) -> Result<ClaudeRootInfo, String> {
    let default_path = claude_dir()?.to_string_lossy().into_owned();
    let effective_path = configured.clone().unwrap_or_else(|| default_path.clone());
    Ok(ClaudeRootInfo {
        default_path,
        configured_path: configured,
        effective_path,
    })
}

/// Mirrors `manager.go:normalizeClaudeRootPath`. Requires an absolute path;
/// strips trailing slashes but preserves the root "/". Does NOT confine the
/// value — that asymmetry matches Go and is intentional.
pub fn normalize_claude_root_path(p: Option<&str>) -> Option<String> {
    let raw = p?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if !Path::new(trimmed).is_absolute() {
        return None;
    }
    let normalized = trimmed.trim_end_matches(['/', '\\']);
    if normalized.is_empty() {
        return Some("/".to_string());
    }
    Some(normalized.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_data_dir_rejects_relative_override() {
        // Absolute override honored; relative rejected — matches appdata.go.
        // (Uses a real env var; scope it tightly and restore.)
        std::env::set_var(APP_DATA_DIR_ENV, "relative/path");
        let err = app_data_dir().unwrap_err();
        assert!(err.contains("must be an absolute path"));
        std::env::set_var(APP_DATA_DIR_ENV, "/abs/dir");
        assert_eq!(app_data_dir().unwrap(), PathBuf::from("/abs/dir"));
        std::env::remove_var(APP_DATA_DIR_ENV);
    }

    #[test]
    fn claude_dir_is_home_dot_claude() {
        let home = dirs::home_dir().unwrap();
        assert_eq!(claude_dir().unwrap(), home.join(".claude"));
        assert_eq!(projects_dir().unwrap(), home.join(".claude").join("projects"));
    }

    #[test]
    fn normalize_matches_go() {
        assert_eq!(normalize_claude_root_path(None), None);
        assert_eq!(normalize_claude_root_path(Some("   ")), None);
        assert_eq!(normalize_claude_root_path(Some("relative")), None);
        assert_eq!(normalize_claude_root_path(Some("/a/b/")), Some("/a/b".to_string()));
        assert_eq!(normalize_claude_root_path(Some("/")), Some("/".to_string()));
    }

    #[test]
    fn claude_root_info_configured_null_when_absent() {
        // configured_path emits null (no skip) — matches ClaudeRootInfo.
        let info = get_claude_root_info(None).unwrap();
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"configuredPath\":null"), "{json}");
        let info2 = get_claude_root_info(Some("/custom".to_string())).unwrap();
        assert_eq!(info2.effective_path, "/custom");
    }

    #[test]
    fn codex_root_requires_absolute_explicit_path() {
        let home = PathBuf::from("/tmp/test-home");
        assert_eq!(
            resolve_codex_dir(None, &home).unwrap(),
            PathBuf::from("/tmp/test-home/.codex")
        );
        assert_eq!(
            resolve_codex_dir(Some("/opt/codex"), &home).unwrap(),
            PathBuf::from("/opt/codex")
        );
        assert!(resolve_codex_dir(Some("relative"), &home).is_err());
    }
}
