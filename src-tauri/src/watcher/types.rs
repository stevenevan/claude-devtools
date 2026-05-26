use notify_debouncer_full::{Debouncer, RecommendedCache};
use serde::Serialize;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Mirrors the TypeScript `FileChangeEvent` from `src/main/types/chunks.ts`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeEvent {
    /// "add" | "change" | "unlink"
    #[serde(rename = "type")]
    pub change_type: String,
    /// Absolute path to the changed file
    pub path: String,
    /// Encoded project directory name (e.g., "-Users-name-project")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    /// Session UUID (filename without extension)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// Whether this is a subagent file
    pub is_subagent: bool,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

pub struct WatcherState {
    pub(crate) debouncer: Option<Debouncer<notify::RecommendedWatcher, RecommendedCache>>,
    pub(crate) watching: bool,
}

impl Default for WatcherState {
    fn default() -> Self {
        Self {
            debouncer: None,
            watching: false,
        }
    }
}
