use serde::{Deserialize, Serialize};

/// Context injection types — tagged union mirroring the TS discriminated union.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "category", rename_all = "kebab-case")]
pub enum ContextInjection {
    #[serde(rename = "claude-md")]
    ClaudeMd(ClaudeMdContextInjection),
    #[serde(rename = "mentioned-file")]
    MentionedFile(MentionedFileInjection),
    #[serde(rename = "tool-output")]
    ToolOutput(ToolOutputInjection),
    #[serde(rename = "thinking-text")]
    ThinkingText(ThinkingTextInjection),
    #[serde(rename = "task-coordination")]
    TaskCoordination(TaskCoordinationInjection),
    #[serde(rename = "user-message")]
    UserMessage(UserMessageInjection),
}

impl ContextInjection {
    pub fn estimated_tokens(&self) -> u64 {
        match self {
            Self::ClaudeMd(i) => i.estimated_tokens,
            Self::MentionedFile(i) => i.estimated_tokens,
            Self::ToolOutput(i) => i.estimated_tokens,
            Self::ThinkingText(i) => i.estimated_tokens,
            Self::TaskCoordination(i) => i.estimated_tokens,
            Self::UserMessage(i) => i.estimated_tokens,
        }
    }

    pub fn path(&self) -> Option<&str> {
        match self {
            Self::ClaudeMd(i) => Some(&i.path),
            Self::MentionedFile(i) => Some(&i.path),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeMdContextInjection {
    pub id: String,
    pub path: String,
    pub source: String,
    pub display_name: String,
    pub is_global: bool,
    pub estimated_tokens: u64,
    pub first_seen_in_group: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MentionedFileInjection {
    pub id: String,
    pub path: String,
    pub display_name: String,
    pub estimated_tokens: u64,
    pub first_seen_turn_index: u32,
    pub first_seen_in_group: String,
    #[serde(default = "default_true")]
    pub exists: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolOutputInjection {
    pub id: String,
    pub turn_index: u32,
    pub ai_group_id: String,
    pub estimated_tokens: u64,
    pub tool_count: u32,
    pub tool_breakdown: Vec<ToolTokenBreakdown>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolTokenBreakdown {
    pub tool_name: String,
    pub token_count: u64,
    pub is_error: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_use_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThinkingTextInjection {
    pub id: String,
    pub turn_index: u32,
    pub ai_group_id: String,
    pub estimated_tokens: u64,
    pub breakdown: Vec<ThinkingTextBreakdown>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThinkingTextBreakdown {
    #[serde(rename = "type")]
    pub item_type: String,
    pub token_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCoordinationInjection {
    pub id: String,
    pub turn_index: u32,
    pub ai_group_id: String,
    pub estimated_tokens: u64,
    pub breakdown: Vec<TaskCoordinationBreakdown>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCoordinationBreakdown {
    #[serde(rename = "type")]
    pub item_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    pub token_count: u64,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserMessageInjection {
    pub id: String,
    pub turn_index: u32,
    pub ai_group_id: String,
    pub estimated_tokens: u64,
    pub text_preview: String,
}

// Token category totals
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokensByCategory {
    pub claude_md: u64,
    pub mentioned_files: u64,
    pub tool_outputs: u64,
    pub thinking_text: u64,
    pub task_coordination: u64,
    pub user_messages: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewCountsByCategory {
    pub claude_md: u32,
    pub mentioned_files: u32,
    pub tool_outputs: u32,
    pub thinking_text: u32,
    pub task_coordination: u32,
    pub user_messages: u32,
}

// ID generation functions

pub fn generate_mentioned_file_id(path: &str) -> String {
    let mut hash: i32 = 0;
    for ch in path.chars() {
        hash = hash.wrapping_shl(5).wrapping_sub(hash).wrapping_add(ch as i32);
    }
    format!("mf-{:x}", hash.unsigned_abs())
}

pub fn generate_tool_output_id(turn_index: u32) -> String {
    format!("tool-output-ai-{}", turn_index)
}

pub fn generate_thinking_text_id(turn_index: u32) -> String {
    format!("thinking-text-ai-{}", turn_index)
}

pub fn generate_task_coordination_id(turn_index: u32) -> String {
    format!("task-coord-ai-{}", turn_index)
}

pub fn generate_user_message_id(turn_index: u32) -> String {
    format!("user-msg-ai-{}", turn_index)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mentioned_file_id_deterministic() {
        let id1 = generate_mentioned_file_id("/Users/test/file.ts");
        let id2 = generate_mentioned_file_id("/Users/test/file.ts");
        assert_eq!(id1, id2);
        assert!(id1.starts_with("mf-"));
    }

    #[test]
    fn different_paths_different_ids() {
        let id1 = generate_mentioned_file_id("/a/b.ts");
        let id2 = generate_mentioned_file_id("/c/d.ts");
        assert_ne!(id1, id2);
    }

    #[test]
    fn tool_output_id_format() {
        assert_eq!(generate_tool_output_id(5), "tool-output-ai-5");
    }

    #[test]
    fn thinking_text_id_format() {
        assert_eq!(generate_thinking_text_id(3), "thinking-text-ai-3");
    }

    #[test]
    fn task_coordination_id_format() {
        assert_eq!(generate_task_coordination_id(7), "task-coord-ai-7");
    }

    #[test]
    fn user_message_id_format() {
        assert_eq!(generate_user_message_id(0), "user-msg-ai-0");
    }

    #[test]
    fn context_injection_serde_roundtrip() {
        let injection = ContextInjection::UserMessage(UserMessageInjection {
            id: "user-msg-ai-0".to_string(),
            turn_index: 0,
            ai_group_id: "ai-0".to_string(),
            estimated_tokens: 50,
            text_preview: "Hello world".to_string(),
        });
        let json = serde_json::to_string(&injection).unwrap();
        assert!(json.contains("\"category\":\"user-message\""));
        let deserialized: ContextInjection = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.estimated_tokens(), 50);
    }
}
