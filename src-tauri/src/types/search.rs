/// Types for in-session content search.

use serde::{Deserialize, Serialize};

/// Where within a chunk the match was found.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ContentMatchSource {
    UserMessage,
    AiText,
    AiThinking,
    ToolCallName,
    ToolCallInput,
    ToolResultContent,
    SystemText,
}

/// A single match position within a session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchMatch {
    /// Index of the chunk in SessionDetail.chunks.
    pub chunk_index: usize,
    /// Chunk ID (e.g. "user-0", "ai-1") — maps to frontend ChatItem group IDs.
    pub chunk_id: String,
    /// Type of chunk: "user", "ai", "system", "compact", "event".
    pub chunk_type: String,
    /// Where within the chunk the match was found.
    pub source: ContentMatchSource,
    /// 0-based index of the content block within the chunk.
    pub content_block_index: usize,
    /// Character offset within the source text where the match starts.
    pub char_offset: usize,
    /// Length of the matched text in characters.
    pub match_length: usize,
    /// Context snippet: surrounding text (~50 chars before/after).
    pub context_snippet: String,
    /// The matched text itself.
    pub matched_text: String,
}

/// Paginated search results.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchResult {
    pub matches: Vec<ContentSearchMatch>,
    pub total_matches: usize,
    pub next_cursor: Option<usize>,
    pub has_more: bool,
    pub query: String,
    pub is_regex: bool,
    pub chunks_searched: usize,
}
