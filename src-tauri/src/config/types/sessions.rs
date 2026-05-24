use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionsConfig {
    pub pinned_sessions: HashMap<String, Vec<PinnedSession>>,
    pub hidden_sessions: HashMap<String, Vec<HiddenSession>>,
    #[serde(default)]
    pub bookmarks: Vec<BookmarkEntry>,
    #[serde(default)]
    pub session_tags: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub annotations: Vec<AnnotationEntry>,
    #[serde(default)]
    pub session_groups: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub filter_presets: Vec<FilterPreset>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_filter_preset_id: Option<String>,
}

/// A saved filter preset (sprint 35). The `filter` payload is stored opaquely
/// as JSON to avoid coupling backend persistence to the frontend
/// `SessionFilterState` shape; the frontend validates fields on read.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterPreset {
    pub id: String,
    pub name: String,
    pub filter: Value,
    pub created_at: f64,
}

// Annotation/Bookmark export bundle (sprint 37).

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationExportBundle {
    pub version: u32,
    pub exported_at: f64,
    pub annotations: Vec<AnnotationEntry>,
    pub bookmarks: Vec<BookmarkEntry>,
}

/// Result of an import operation. Per-category counts let the UI surface
/// what changed without diffing the resulting config.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub annotations_added: u32,
    pub annotations_updated: u32,
    pub annotations_skipped: u32,
    pub bookmarks_added: u32,
    pub bookmarks_skipped: u32,
}

/// Inline annotation anchored to a specific display target (AI group, turn, item) in a session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationEntry {
    pub id: String,
    pub session_id: String,
    pub project_id: String,
    pub target_id: String,
    pub text: String,
    pub color: String,
    pub created_at: f64,
    pub updated_at: f64,
}

/// A bookmark on a specific AI group within a session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkEntry {
    pub id: String,
    pub session_id: String,
    pub project_id: String,
    pub group_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    pub created_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinnedSession {
    pub session_id: String,
    pub pinned_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HiddenSession {
    pub session_id: String,
    pub hidden_at: f64,
}

impl Default for SessionsConfig {
    fn default() -> Self {
        Self {
            pinned_sessions: HashMap::new(),
            hidden_sessions: HashMap::new(),
            bookmarks: vec![],
            session_tags: HashMap::new(),
            annotations: vec![],
            session_groups: HashMap::new(),
            filter_presets: vec![],
            default_filter_preset_id: None,
        }
    }
}
