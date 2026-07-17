//! Claude-root + app-data path resolution (W3 subset of `internal/config`).
//!
//! Security asymmetry, preserved from Go: the configurable `claude_root_path`
//! is an APP-path resolver only and is intentionally unconfined
//! (`normalize_claude_root_path` accepts "/"). The CLI twin and any path
//! confinement guard anchor to `dirs::home_dir()/.claude` and MUST NOT consult
//! the config root — see `cmd/cli/main.go`, which never reads config.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const APP_DATA_DIR_ENV: &str = "CLAUDE_DEVTOOLS_DIR";

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
}
