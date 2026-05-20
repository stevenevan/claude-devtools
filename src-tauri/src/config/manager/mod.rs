/// ConfigState — manages app configuration with load/save/CRUD operations.

use std::path::PathBuf;

use super::types::{AppConfig, ClaudeRootInfo};

mod annotations;
mod merge_helpers;
mod notifications_ops;
mod sessions_ops;
mod triggers_ops;
use merge_helpers::{load_config_from_disk, now_millis, resolve_config_path};

// ConfigState

pub struct ConfigState {
    pub(super) config: AppConfig,
    pub(super) config_path: PathBuf,
}

impl ConfigState {
    /// Create a new ConfigState, loading from disk or using defaults.
    pub fn new() -> Self {
        let config_path = resolve_config_path();
        let config = load_config_from_disk(&config_path);
        Self {
            config,
            config_path,
        }
    }

    #[cfg(test)]
    pub fn new_with_path(config_path: PathBuf) -> Self {
        let config = load_config_from_disk(&config_path);
        Self {
            config,
            config_path,
        }
    }

    // =========================================================================
    // Config Access
    // =========================================================================

    /// Get a clone of the full config (with snooze auto-expiry check).
    pub fn get_config(&mut self) -> AppConfig {
        self.auto_expire_snooze();
        self.config.clone()
    }

    /// Get the config file path.
    pub fn get_config_path(&self) -> &std::path::Path {
        &self.config_path
    }

    // =========================================================================
    // Claude Root Info
    // =========================================================================

    pub fn get_claude_root_info(&self) -> ClaudeRootInfo {
        let default_path = dirs::home_dir()
            .map(|h| h.join(".claude").to_string_lossy().to_string())
            .unwrap_or_else(|| "~/.claude".to_string());

        let configured = self.config.general.claude_root_path.clone();
        let effective = configured.clone().unwrap_or_else(|| default_path.clone());

        ClaudeRootInfo {
            default_path,
            configured_path: configured,
            effective_path: effective,
        }
    }

    // =========================================================================
    // Internal
    // =========================================================================

    fn save_config(&self) {
        let config_dir = self.config_path.parent();
        if let Some(dir) = config_dir {
            if !dir.exists() {
                let _ = std::fs::create_dir_all(dir);
            }
        }

        match serde_json::to_string_pretty(&self.config) {
            Ok(content) => {
                // Atomic write: write to temp, then rename
                let tmp_path = self.config_path.with_extension("tmp");
                if std::fs::write(&tmp_path, &content).is_ok() {
                    let _ = std::fs::rename(&tmp_path, &self.config_path);
                } else {
                    // Fallback: direct write
                    let _ = std::fs::write(&self.config_path, &content);
                }
            }
            Err(e) => {
                tracing::error!(target: "config", error = %e, "failed to serialize config");
            }
        }
    }

    fn auto_expire_snooze(&mut self) {
        if let Some(until) = self.config.notifications.snoozed_until {
            if now_millis() >= until {
                self.config.notifications.snoozed_until = None;
                self.save_config();
            }
        }
    }
}


#[cfg(test)]
#[path = "tests.rs"]
mod tests;
