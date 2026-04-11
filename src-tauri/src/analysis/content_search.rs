/// In-session full-text content search.
///
/// Searches through parsed session chunks for text matches with optional regex
/// support and cursor-based pagination.

use regex::Regex;

use crate::types::chunks::EnhancedChunk;
use crate::types::jsonl::{ContentBlock, ToolResultContentValue};
use crate::types::messages::ParsedMessageContent;
use crate::types::search::{ContentMatchSource, ContentSearchMatch, ContentSearchResult};

// ---------------------------------------------------------------------------
// Matcher
// ---------------------------------------------------------------------------

enum SearchMatcher {
    Plain {
        query_lower: String,
        case_sensitive: bool,
        original_query: String,
    },
    Regex {
        pattern: Regex,
    },
}

impl SearchMatcher {
    fn new(query: &str, is_regex: bool, case_sensitive: bool) -> Result<Self, String> {
        if is_regex {
            let pattern = regex::RegexBuilder::new(query)
                .case_insensitive(!case_sensitive)
                .build()
                .map_err(|e| format!("Invalid regex pattern: {e}"))?;
            Ok(Self::Regex { pattern })
        } else {
            Ok(Self::Plain {
                query_lower: query.to_lowercase(),
                case_sensitive,
                original_query: query.to_string(),
            })
        }
    }

    /// Returns all (byte_offset, byte_length) pairs for matches in text.
    /// Offsets are character-based for frontend compatibility.
    fn find_all(&self, text: &str) -> Vec<(usize, usize)> {
        match self {
            Self::Plain {
                query_lower,
                case_sensitive,
                original_query,
            } => {
                if *case_sensitive {
                    plain_find_all(text, original_query)
                } else {
                    let lower = text.to_lowercase();
                    // Map byte offsets in lowered text back to char offsets in original
                    let byte_matches = plain_find_all(&lower, query_lower);
                    byte_matches
                        .into_iter()
                        .map(|(byte_off, _)| {
                            let char_off = text[..byte_off].chars().count();
                            let char_len = original_query.chars().count();
                            (char_off, char_len)
                        })
                        .collect()
                }
            }
            Self::Regex { pattern } => pattern
                .find_iter(text)
                .map(|m| {
                    let char_off = text[..m.start()].chars().count();
                    let char_len = m.as_str().chars().count();
                    (char_off, char_len)
                })
                .collect(),
        }
    }
}

fn plain_find_all(haystack: &str, needle: &str) -> Vec<(usize, usize)> {
    let mut results = Vec::new();
    let needle_len = needle.len();
    if needle_len == 0 {
        return results;
    }
    let mut start = 0;
    while let Some(pos) = haystack[start..].find(needle) {
        let abs_pos = start + pos;
        results.push((abs_pos, needle_len));
        start = abs_pos + needle_len;
    }
    results
}

// ---------------------------------------------------------------------------
// Snippet extraction
// ---------------------------------------------------------------------------

fn extract_snippet(text: &str, char_offset: usize, match_char_len: usize) -> String {
    let chars: Vec<char> = text.chars().collect();
    let total = chars.len();
    let ctx = 50;

    let start = char_offset.saturating_sub(ctx);
    let end = (char_offset + match_char_len + ctx).min(total);

    chars[start..end].iter().collect()
}

fn matched_text_from(text: &str, char_offset: usize, match_char_len: usize) -> String {
    text.chars()
        .skip(char_offset)
        .take(match_char_len)
        .collect()
}

// ---------------------------------------------------------------------------
// Text extraction helpers
// ---------------------------------------------------------------------------

/// Represents a searchable text region within a chunk.
struct SearchableRegion {
    text: String,
    source: ContentMatchSource,
    content_block_index: usize,
}

fn extract_message_text(content: &ParsedMessageContent) -> Vec<(String, ContentMatchSource, usize)> {
    match content {
        ParsedMessageContent::Text(s) => vec![(s.clone(), ContentMatchSource::AiText, 0)],
        ParsedMessageContent::Blocks(blocks) => {
            let mut result = Vec::new();
            for (i, block) in blocks.iter().enumerate() {
                match block {
                    ContentBlock::Text { text } => {
                        result.push((text.clone(), ContentMatchSource::AiText, i));
                    }
                    ContentBlock::Thinking { thinking, .. } => {
                        result.push((thinking.clone(), ContentMatchSource::AiThinking, i));
                    }
                    ContentBlock::ToolUse { name, input, .. } => {
                        result.push((name.clone(), ContentMatchSource::ToolCallName, i));
                        let input_str = serde_json::to_string(input).unwrap_or_default();
                        result.push((input_str, ContentMatchSource::ToolCallInput, i));
                    }
                    ContentBlock::ToolResult { content, .. } => {
                        let text = tool_result_content_text(content);
                        if !text.is_empty() {
                            result.push((text, ContentMatchSource::ToolResultContent, i));
                        }
                    }
                    ContentBlock::Image { .. } => {}
                }
            }
            result
        }
    }
}

fn tool_result_content_text(content: &ToolResultContentValue) -> String {
    match content {
        ToolResultContentValue::Text(s) => s.clone(),
        ToolResultContentValue::Blocks(blocks) => blocks
            .iter()
            .filter_map(|b| match b {
                ContentBlock::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n"),
    }
}

fn extract_regions(chunk: &EnhancedChunk) -> Vec<SearchableRegion> {
    let mut regions = Vec::new();

    match chunk {
        EnhancedChunk::User(user) => {
            match &user.user_message.content {
                ParsedMessageContent::Text(s) => {
                    regions.push(SearchableRegion {
                        text: s.clone(),
                        source: ContentMatchSource::UserMessage,
                        content_block_index: 0,
                    });
                }
                ParsedMessageContent::Blocks(blocks) => {
                    for (i, block) in blocks.iter().enumerate() {
                        if let ContentBlock::Text { text } = block {
                            regions.push(SearchableRegion {
                                text: text.clone(),
                                source: ContentMatchSource::UserMessage,
                                content_block_index: i,
                            });
                        }
                    }
                }
            }
        }
        EnhancedChunk::Ai(ai) => {
            // Search AI response text/thinking blocks
            for (i, msg) in ai.responses.iter().enumerate() {
                let extracted = extract_message_text(&msg.content);
                for (text, source, block_idx) in extracted {
                    regions.push(SearchableRegion {
                        text,
                        source,
                        content_block_index: i * 100 + block_idx,
                    });
                }
            }
            // Search tool executions
            for (i, exec) in ai.tool_executions.iter().enumerate() {
                regions.push(SearchableRegion {
                    text: exec.tool_call.name.clone(),
                    source: ContentMatchSource::ToolCallName,
                    content_block_index: 1000 + i,
                });
                let input_str = serde_json::to_string(&exec.tool_call.input).unwrap_or_default();
                regions.push(SearchableRegion {
                    text: input_str,
                    source: ContentMatchSource::ToolCallInput,
                    content_block_index: 1000 + i,
                });
                if let Some(result) = &exec.result {
                    let text = serde_json::to_string(&result.content).unwrap_or_default();
                    if !text.is_empty() {
                        regions.push(SearchableRegion {
                            text,
                            source: ContentMatchSource::ToolResultContent,
                            content_block_index: 1000 + i,
                        });
                    }
                }
            }
        }
        EnhancedChunk::System(sys) => {
            regions.push(SearchableRegion {
                text: sys.command_output.clone(),
                source: ContentMatchSource::SystemText,
                content_block_index: 0,
            });
        }
        EnhancedChunk::Compact(compact) => {
            match &compact.message.content {
                ParsedMessageContent::Text(s) => {
                    regions.push(SearchableRegion {
                        text: s.clone(),
                        source: ContentMatchSource::SystemText,
                        content_block_index: 0,
                    });
                }
                ParsedMessageContent::Blocks(blocks) => {
                    for (i, block) in blocks.iter().enumerate() {
                        if let ContentBlock::Text { text } = block {
                            regions.push(SearchableRegion {
                                text: text.clone(),
                                source: ContentMatchSource::SystemText,
                                content_block_index: i,
                            });
                        }
                    }
                }
            }
        }
        EnhancedChunk::Event(_) => {
            // Events rarely contain searchable user content; skip.
        }
    }

    regions
}

fn chunk_id(chunk: &EnhancedChunk) -> &str {
    match chunk {
        EnhancedChunk::User(c) => &c.id,
        EnhancedChunk::Ai(c) => &c.id,
        EnhancedChunk::System(c) => &c.id,
        EnhancedChunk::Compact(c) => &c.id,
        EnhancedChunk::Event(c) => &c.id,
    }
}

fn chunk_type_str(chunk: &EnhancedChunk) -> &'static str {
    match chunk {
        EnhancedChunk::User(_) => "user",
        EnhancedChunk::Ai(_) => "ai",
        EnhancedChunk::System(_) => "system",
        EnhancedChunk::Compact(_) => "compact",
        EnhancedChunk::Event(_) => "event",
    }
}

// ---------------------------------------------------------------------------
// Main search function
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE: usize = 100;
const MAX_PAGE_SIZE: usize = 1000;

pub fn search_chunks(
    chunks: &[EnhancedChunk],
    query: &str,
    is_regex: bool,
    case_sensitive: bool,
    cursor: Option<usize>,
    page_size: Option<usize>,
) -> Result<ContentSearchResult, String> {
    let matcher = SearchMatcher::new(query, is_regex, case_sensitive)?;
    let page_size = page_size.unwrap_or(DEFAULT_PAGE_SIZE).min(MAX_PAGE_SIZE);
    let skip = cursor.unwrap_or(0);

    let mut all_matches: Vec<ContentSearchMatch> = Vec::new();

    for (chunk_index, chunk) in chunks.iter().enumerate() {
        let regions = extract_regions(chunk);
        let cid = chunk_id(chunk).to_string();
        let ctype = chunk_type_str(chunk).to_string();

        for region in &regions {
            let hits = matcher.find_all(&region.text);
            for (char_offset, match_len) in hits {
                all_matches.push(ContentSearchMatch {
                    chunk_index,
                    chunk_id: cid.clone(),
                    chunk_type: ctype.clone(),
                    source: region.source.clone(),
                    content_block_index: region.content_block_index,
                    char_offset,
                    match_length: match_len,
                    context_snippet: extract_snippet(&region.text, char_offset, match_len),
                    matched_text: matched_text_from(&region.text, char_offset, match_len),
                });
            }
        }
    }

    let total_matches = all_matches.len();
    let page_matches: Vec<ContentSearchMatch> = all_matches
        .into_iter()
        .skip(skip)
        .take(page_size)
        .collect();

    let consumed = skip + page_matches.len();
    let has_more = consumed < total_matches;
    let next_cursor = if has_more { Some(consumed) } else { None };

    Ok(ContentSearchResult {
        matches: page_matches,
        total_matches,
        next_cursor,
        has_more,
        query: query.to_string(),
        is_regex,
        chunks_searched: chunks.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_plain_find_all() {
        let hits = plain_find_all("hello world hello", "hello");
        assert_eq!(hits, vec![(0, 5), (12, 5)]);
    }

    #[test]
    fn test_plain_find_all_no_match() {
        let hits = plain_find_all("hello world", "xyz");
        assert!(hits.is_empty());
    }

    #[test]
    fn test_extract_snippet() {
        let text = "The quick brown fox jumps over the lazy dog";
        let snippet = extract_snippet(text, 10, 5);
        assert!(snippet.contains("brown"));
    }

    #[test]
    fn test_matcher_case_insensitive() {
        let matcher = SearchMatcher::new("Hello", false, false).unwrap();
        let hits = matcher.find_all("hello HELLO Hello");
        assert_eq!(hits.len(), 3);
    }

    #[test]
    fn test_matcher_case_sensitive() {
        let matcher = SearchMatcher::new("Hello", false, true).unwrap();
        let hits = matcher.find_all("hello HELLO Hello");
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn test_matcher_regex() {
        let matcher = SearchMatcher::new(r"fn\s+\w+", true, false).unwrap();
        let hits = matcher.find_all("fn hello() { fn world() }");
        assert_eq!(hits.len(), 2);
    }

    #[test]
    fn test_matcher_invalid_regex() {
        let result = SearchMatcher::new("[invalid", true, false);
        assert!(result.is_err());
    }
}
