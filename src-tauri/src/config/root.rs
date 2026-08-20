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
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::types::codex_maintenance::{
    MaintenanceCapabilities, MaintenanceCapability, MaintenanceCapabilityState,
};
use crate::types::source::{
    Diagnostic, SourceCapabilities, SourceKind, SourceState, SourceStatus, TaskGraphCapability,
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
    let configured =
        std::env::var_os(CODEX_HOME_ENV).map(|value| value.to_string_lossy().into_owned());
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
    let configured =
        std::env::var_os(CODEX_HOME_ENV).map(|value| value.to_string_lossy().into_owned());
    let label = if configured
        .as_deref()
        .map(str::trim)
        .is_some_and(|value| !value.is_empty())
    {
        CODEX_HOME_ENV.to_string()
    } else {
        "~/.codex".to_string()
    };
    let capabilities = codex_capabilities(None);

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
            return missing_codex_status(label, capabilities);
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
    classify_codex_source_status(&path, label, metadata, capabilities)
}

/// Returns the legacy Claude source status without depending on the command
/// layer. Source-aware commands use this helper so they do not call another
/// command module to assemble maintenance state.
pub fn get_claude_source_status() -> SourceStatus {
    let root = match claude_dir() {
        Ok(root) => root,
        Err(reason) => {
            return SourceStatus {
                source_kind: SourceKind::Claude,
                state: SourceState::Invalid,
                label: "~/.claude".to_string(),
                revision: None,
                reason: Some(reason),
                capabilities: claude_capabilities(),
            }
        }
    };
    match std::fs::metadata(&root) {
        Ok(metadata) if metadata.is_dir() => SourceStatus {
            source_kind: SourceKind::Claude,
            state: SourceState::Available,
            label: "~/.claude".to_string(),
            revision: source_revision(&root),
            reason: None,
            capabilities: claude_capabilities(),
        },
        Ok(_) => SourceStatus {
            source_kind: SourceKind::Claude,
            state: SourceState::Invalid,
            label: "~/.claude".to_string(),
            revision: None,
            reason: Some("Claude data root is not a directory".to_string()),
            capabilities: claude_capabilities(),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => SourceStatus {
            source_kind: SourceKind::Claude,
            state: SourceState::NotFound,
            label: "~/.claude".to_string(),
            revision: None,
            reason: Some("Claude data directory was not found".to_string()),
            capabilities: claude_capabilities(),
        },
        Err(error) => SourceStatus {
            source_kind: SourceKind::Claude,
            state: SourceState::Unreadable,
            label: "~/.claude".to_string(),
            revision: None,
            reason: Some(format!("cannot inspect Claude data directory: {error}")),
            capabilities: claude_capabilities(),
        },
    }
}

fn missing_codex_status(label: String, capabilities: SourceCapabilities) -> SourceStatus {
    SourceStatus {
        source_kind: SourceKind::Codex,
        state: SourceState::NotFound,
        label,
        revision: None,
        reason: Some("Codex data directory was not found".to_string()),
        capabilities,
    }
}

fn classify_codex_source_status(
    path: &Path,
    label: String,
    metadata: std::fs::Metadata,
    fallback_capabilities: SourceCapabilities,
) -> SourceStatus {
    if !metadata.is_dir() {
        return SourceStatus {
            source_kind: SourceKind::Codex,
            state: SourceState::Invalid,
            label,
            revision: None,
            reason: Some("Codex data root is not a directory".to_string()),
            capabilities: fallback_capabilities,
        };
    }
    if let Err(error) = std::fs::read_dir(path) {
        return SourceStatus {
            source_kind: SourceKind::Codex,
            state: SourceState::Unreadable,
            label,
            revision: None,
            reason: Some(format!("cannot read Codex data directory: {error}")),
            capabilities: fallback_capabilities,
        };
    }

    SourceStatus {
        source_kind: SourceKind::Codex,
        state: SourceState::Available,
        label,
        revision: source_revision(path),
        reason: None,
        capabilities: codex_capabilities(Some(path)),
    }
}

fn codex_capabilities(root: Option<&Path>) -> SourceCapabilities {
    let task_graph = match root.map(|path| path.join("tasks")) {
        Some(path) => match std::fs::symlink_metadata(path) {
            Ok(metadata) if metadata.file_type().is_symlink() => TaskGraphCapability::unsupported(
                "Codex task graphs directory is not a compatible directory",
            ),
            Ok(metadata) if metadata.is_dir() => TaskGraphCapability::available(),
            Ok(_) => TaskGraphCapability::unsupported(
                "Codex task graphs directory is not a compatible directory",
            ),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                TaskGraphCapability::missing("Codex task graphs directory was not found")
            }
            Err(error) => TaskGraphCapability::unsupported(format!(
                "cannot inspect Codex task graphs directory: {error}"
            )),
        },
        None => TaskGraphCapability::missing("Codex data directory was not found"),
    };
    SourceCapabilities {
        sessions: true,
        transcripts: true,
        task_graph,
        maintenance: maintenance_capabilities(root),
    }
}

pub fn maintenance_capabilities(root: Option<&Path>) -> MaintenanceCapabilities {
    MaintenanceCapabilities {
        usage: codex_schema_capability(
            root,
            "stats-cache.json",
            false,
            "Usage cache",
            "usageSchemaUnsupported",
        ),
        telemetry: codex_schema_capability(
            root,
            "telemetry",
            true,
            "Telemetry",
            "telemetrySchemaUnsupported",
        ),
        file_history: codex_schema_capability(
            root,
            "file-history",
            true,
            "File history",
            "fileHistorySchemaUnsupported",
        ),
        shell_snapshots: maintenance_capability(root, "shell_snapshots", true, "Shell snapshots"),
    }
}

pub fn claude_maintenance_capabilities(root: Option<&Path>) -> MaintenanceCapabilities {
    MaintenanceCapabilities {
        usage: maintenance_capability(root, "stats-cache.json", false, "Usage cache"),
        telemetry: maintenance_capability(root, "telemetry", true, "Telemetry"),
        file_history: maintenance_capability(root, "file-history", true, "File history"),
        shell_snapshots: maintenance_capability(root, "shell-snapshots", true, "Shell snapshots"),
    }
}

fn claude_capabilities() -> SourceCapabilities {
    let maintenance = match claude_dir() {
        Ok(root) => claude_maintenance_capabilities(Some(&root)),
        Err(_) => claude_maintenance_capabilities(None),
    };
    SourceCapabilities {
        sessions: true,
        transcripts: true,
        task_graph: claude_task_graph_capability(),
        maintenance,
    }
}

fn claude_task_graph_capability() -> TaskGraphCapability {
    TaskGraphCapability {
        state: crate::types::source::TaskGraphCapabilityState::Available,
        reason: "Claude Task Graph files are available".to_string(),
        diagnostics: Vec::new(),
    }
}

fn codex_schema_capability(
    root: Option<&Path>,
    relative: &str,
    expect_directory: bool,
    label: &str,
    diagnostic_code: &str,
) -> MaintenanceCapability {
    let capability = maintenance_capability(root, relative, expect_directory, label);
    if capability.state != MaintenanceCapabilityState::Available {
        return capability;
    }
    MaintenanceCapability {
        state: MaintenanceCapabilityState::Unsupported,
        reason: format!("{label} producer contract is not pinned"),
        diagnostics: vec![Diagnostic::new(
            diagnostic_code,
            format!("{label} is present, but its Codex producer contract is not pinned"),
        )],
    }
}

fn maintenance_capability(
    root: Option<&Path>,
    relative: &str,
    expect_directory: bool,
    label: &str,
) -> MaintenanceCapability {
    let Some(root) = root else {
        return MaintenanceCapability::missing(format!("{label} root is not available"));
    };
    let path = root.join(relative);
    match std::fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            MaintenanceCapability::unsupported(format!("{label} path is a symlink"))
        }
        Ok(metadata) if expect_directory && metadata.is_dir() => MaintenanceCapability::available(),
        Ok(metadata) if !expect_directory && metadata.is_file() => {
            MaintenanceCapability::available()
        }
        Ok(_) => MaintenanceCapability::unsupported(format!(
            "{label} path is not the expected {}",
            if expect_directory {
                "directory"
            } else {
                "file"
            }
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            MaintenanceCapability::missing(format!("{label} was not found"))
        }
        Err(error) => MaintenanceCapability::unreadable(format!("cannot inspect {label}: {error}")),
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
        "tasks",
    ] {
        let path = root.join(name);
        name.hash(&mut hasher);
        match std::fs::metadata(path) {
            Ok(metadata) => {
                metadata.len().hash(&mut hasher);
                metadata
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                    .map(|modified| {
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

/// Returns a bounded metadata revision for one maintenance dataset. Directory
/// entries are capped and sorted so refreshes do not hash or read the dataset's
/// contents merely to invalidate a renderer cache.
pub fn maintenance_revision(root: &Path, dataset: &str) -> Option<String> {
    const MAX_ENTRIES: usize = 5_000;
    let mut hasher = DefaultHasher::new();
    root.to_string_lossy().hash(&mut hasher);
    dataset.hash(&mut hasher);
    let path = root.join(dataset);
    let metadata = std::fs::symlink_metadata(&path).ok()?;
    metadata.file_type().is_symlink().hash(&mut hasher);
    metadata.is_dir().hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|modified| modified.as_nanos().hash(&mut hasher));

    let mut scan_limited = false;
    if metadata.is_dir() {
        let mut pending = vec![path];
        let mut entries = Vec::new();
        while let Some(directory) = pending.pop() {
            let read_dir = match std::fs::read_dir(directory) {
                Ok(read_dir) => read_dir,
                Err(_) => {
                    "unreadable".hash(&mut hasher);
                    continue;
                }
            };
            for entry in read_dir {
                if entries.len() >= MAX_ENTRIES {
                    scan_limited = true;
                    break;
                }
                let Ok(entry) = entry else {
                    "entry-error".hash(&mut hasher);
                    continue;
                };
                let entry_path = entry.path();
                let Ok(entry_metadata) = std::fs::symlink_metadata(&entry_path) else {
                    "metadata-error".hash(&mut hasher);
                    continue;
                };
                let relative = entry_path
                    .strip_prefix(root)
                    .ok()
                    .map(|value| value.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_else(|| entry_path.to_string_lossy().into_owned());
                let modified = entry_metadata
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                    .map(|time| time.as_nanos())
                    .unwrap_or_default();
                entries.push((
                    relative,
                    entry_metadata.file_type().is_symlink(),
                    entry_metadata.is_dir(),
                    entry_metadata.len(),
                    modified,
                ));
                if entry_metadata.is_dir() && !entry_metadata.file_type().is_symlink() {
                    pending.push(entry_path);
                }
            }
            if scan_limited {
                break;
            }
        }
        entries.sort_by(|left, right| left.0.cmp(&right.0));
        scan_limited.hash(&mut hasher);
        for (relative, is_symlink, is_dir, size, modified) in entries {
            relative.hash(&mut hasher);
            is_symlink.hash(&mut hasher);
            is_dir.hash(&mut hasher);
            size.hash(&mut hasher);
            modified.hash(&mut hasher);
        }
    }
    let revision = format!("{:016x}", hasher.finish());
    if scan_limited {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        Some(format!("incomplete-{revision}-{now}"))
    } else {
        Some(revision)
    }
}

pub(crate) fn home_dir() -> Result<PathBuf, String> {
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
        assert_eq!(
            projects_dir().unwrap(),
            home.join(".claude").join("projects")
        );
    }

    #[test]
    fn normalize_matches_go() {
        assert_eq!(normalize_claude_root_path(None), None);
        assert_eq!(normalize_claude_root_path(Some("   ")), None);
        assert_eq!(normalize_claude_root_path(Some("relative")), None);
        assert_eq!(
            normalize_claude_root_path(Some("/a/b/")),
            Some("/a/b".to_string())
        );
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
        assert_eq!(
            resolve_codex_dir(Some("   "), &home).unwrap(),
            PathBuf::from("/tmp/test-home/.codex")
        );
        assert_eq!(
            resolve_codex_dir(Some("/tmp/test-home/.Codex"), &home).unwrap(),
            PathBuf::from("/tmp/test-home/.Codex")
        );
    }

    #[test]
    fn codex_status_classifies_missing_file_and_available_roots() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("claude-codex-status-{nonce}"));
        std::fs::create_dir_all(root.join("tasks")).unwrap();
        let capabilities = codex_capabilities(None);
        let missing = missing_codex_status("CODEX_HOME".to_string(), capabilities.clone());
        assert_eq!(missing.state, SourceState::NotFound);

        let file = root.with_extension("file");
        std::fs::write(&file, "not a directory").unwrap();
        let invalid = classify_codex_source_status(
            &file,
            "CODEX_HOME".to_string(),
            std::fs::metadata(&file).unwrap(),
            capabilities.clone(),
        );
        assert_eq!(invalid.state, SourceState::Invalid);

        let available = classify_codex_source_status(
            &root,
            "CODEX_HOME".to_string(),
            std::fs::metadata(&root).unwrap(),
            capabilities,
        );
        assert_eq!(available.state, SourceState::Available);
        assert_eq!(
            available.capabilities.task_graph.state,
            crate::types::source::TaskGraphCapabilityState::Available
        );
        crate::testutil::remove_tree(root);
        let _ = std::fs::remove_file(file);
    }
}
