/// Detect whether a JSONL session file represents an ongoing (active) session.
///
/// A session is "ongoing" when Claude is actively processing — mid-response,
/// executing tools, or awaiting tool results. Detection combines:
/// 1. File recency: mtime within the last 120 seconds
/// 2. Structural analysis: the last JSONL entry indicates an incomplete turn

use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::time::{Duration, SystemTime};

use serde_json::Value;

/// Maximum age (in seconds) for a file to be considered potentially ongoing.
/// Files older than this are always considered "not ongoing", even if structurally incomplete.
const ONGOING_MAX_AGE_SECS: u64 = 120;

/// How many bytes to read from the end of the file to find the last line.
const TAIL_BUFFER_SIZE: u64 = 8192;

/// Detect if a session JSONL file represents an ongoing session.
///
/// Returns `Some(true)` if ongoing, `Some(false)` if not, `None` if detection failed.
pub fn detect_ongoing(file_path: &Path) -> Option<bool> {
    // Check file modification time
    let metadata = file_path.metadata().ok()?;
    let mtime = metadata.modified().ok()?;
    let elapsed = SystemTime::now().duration_since(mtime).ok()?;

    // If file hasn't been modified recently, it's not ongoing
    if elapsed > Duration::from_secs(ONGOING_MAX_AGE_SECS) {
        return Some(false);
    }

    // Read the last JSONL line from the file
    let last_line = read_last_jsonl_line(file_path)?;

    // Parse and analyze the entry
    let entry: Value = serde_json::from_str(&last_line).ok()?;
    Some(is_entry_ongoing(&entry))
}

/// Analyze a parsed JSONL entry to determine if it represents an ongoing state.
fn is_entry_ongoing(entry: &Value) -> bool {
    let entry_type = match entry.get("type").and_then(|v| v.as_str()) {
        Some(t) => t,
        None => return false,
    };

    match entry_type {
        "assistant" => {
            // Check stop_reason from the nested message object
            let stop_reason = entry
                .get("message")
                .and_then(|m| m.get("stop_reason"))
                .and_then(|v| v.as_str());

            match stop_reason {
                Some("end_turn") => {
                    // Claude decided to stop — but check if there are pending tool_use blocks
                    // (shouldn't happen with end_turn, but be safe)
                    !has_end_turn_without_tool_use(entry)
                }
                Some("tool_use") => true, // Waiting for tool execution
                Some("max_tokens") => false, // Hit token limit, turn is over
                Some(_) => false,          // Unknown stop reason, treat as done
                None => true,              // No stop_reason = still streaming
            }
        }
        "user" => {
            // isMeta: true = tool result being sent back to Claude → ongoing
            // isMeta: false = real user message, Claude should start processing → ongoing
            // Both cases: if the file was recently modified, Claude is likely processing
            true
        }
        // Non-conversational entries (progress, system events, etc.) during active session
        "progress" => true,
        "system" => {
            // System events like api_error with retry → ongoing
            // Other system events near the end could indicate active processing
            let subtype = entry.get("subtype").and_then(|v| v.as_str());
            matches!(subtype, Some("api_error") | Some("tool_started"))
        }
        // Metadata entries at the end (custom-title, agent-name) are written after completion
        "custom-title" | "agent-name" | "memory_saved" | "turn_duration" => false,
        _ => false,
    }
}

/// Check if an assistant entry has stop_reason "end_turn" with no tool_use blocks.
/// Returns true when the turn is genuinely complete.
fn has_end_turn_without_tool_use(entry: &Value) -> bool {
    let content = match entry
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_array())
    {
        Some(arr) => arr,
        None => return true, // No content array = turn is complete
    };

    // Check if any content block is a tool_use
    let has_tool_use = content.iter().any(|block| {
        block
            .get("type")
            .and_then(|t| t.as_str())
            .is_some_and(|t| t == "tool_use")
    });

    !has_tool_use
}

/// Read the last non-empty line from a file by seeking near the end.
/// This is O(1) regardless of file size.
fn read_last_jsonl_line(file_path: &Path) -> Option<String> {
    let mut file = std::fs::File::open(file_path).ok()?;
    let file_len = file.metadata().ok()?.len();

    if file_len == 0 {
        return None;
    }

    // Seek to near the end of the file
    let read_start = file_len.saturating_sub(TAIL_BUFFER_SIZE);
    file.seek(SeekFrom::Start(read_start)).ok()?;

    let mut buffer = String::new();
    file.read_to_string(&mut buffer).ok()?;

    // Find the last non-empty line
    buffer
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_assistant_end_turn_not_ongoing() {
        let entry: Value = serde_json::from_str(
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Done!"}],"stop_reason":"end_turn","stop_sequence":null}}"#,
        )
        .unwrap();
        assert!(!is_entry_ongoing(&entry));
    }

    #[test]
    fn test_assistant_tool_use_ongoing() {
        let entry: Value = serde_json::from_str(
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Read","input":{}}],"stop_reason":"tool_use"}}"#,
        )
        .unwrap();
        assert!(is_entry_ongoing(&entry));
    }

    #[test]
    fn test_assistant_no_stop_reason_ongoing() {
        let entry: Value = serde_json::from_str(
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"thinking..."}]}}"#,
        )
        .unwrap();
        assert!(is_entry_ongoing(&entry));
    }

    #[test]
    fn test_user_meta_ongoing() {
        let entry: Value = serde_json::from_str(
            r#"{"type":"user","isMeta":true,"message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}"#,
        )
        .unwrap();
        assert!(is_entry_ongoing(&entry));
    }

    #[test]
    fn test_user_real_ongoing() {
        let entry: Value = serde_json::from_str(
            r#"{"type":"user","isMeta":false,"message":{"role":"user","content":"Hello"}}"#,
        )
        .unwrap();
        assert!(is_entry_ongoing(&entry));
    }

    #[test]
    fn test_progress_ongoing() {
        let entry: Value = serde_json::from_str(
            r#"{"type":"progress","toolUseID":"t1","data":{"content":"reading file..."}}"#,
        )
        .unwrap();
        assert!(is_entry_ongoing(&entry));
    }

    #[test]
    fn test_custom_title_not_ongoing() {
        let entry: Value =
            serde_json::from_str(r#"{"type":"custom-title","customTitle":"My Session"}"#).unwrap();
        assert!(!is_entry_ongoing(&entry));
    }

    #[test]
    fn test_turn_duration_not_ongoing() {
        let entry: Value =
            serde_json::from_str(r#"{"type":"turn_duration","durationMs":5000}"#).unwrap();
        assert!(!is_entry_ongoing(&entry));
    }

    #[test]
    fn test_assistant_max_tokens_not_ongoing() {
        let entry: Value = serde_json::from_str(
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"..."}],"stop_reason":"max_tokens"}}"#,
        )
        .unwrap();
        assert!(!is_entry_ongoing(&entry));
    }
}
