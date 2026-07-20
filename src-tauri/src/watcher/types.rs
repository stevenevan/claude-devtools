use serde::Serialize;

/// Mirrors Go `watcher.FileChangeEvent` (internal/watcher/types.go) byte-for-byte:
/// `serde(rename_all = "camelCase")` + `type` rename, with `projectId`/`sessionId`
/// omitted when absent (Go `omitempty` on the pointers) and `isSubagent` always
/// emitted. Also matches TypeScript `FileChangeEvent`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeEvent {
    /// "add" | "change" | "unlink"
    #[serde(rename = "type")]
    pub change_type: String,
    /// Absolute path to the changed file.
    pub path: String,
    /// Encoded project directory name (e.g. "-Users-name-project").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    /// Session UUID (filename without extension).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// Whether this is a subagent file.
    pub is_subagent: bool,
}
