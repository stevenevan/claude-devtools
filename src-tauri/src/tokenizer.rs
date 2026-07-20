//! Ports internal/tokenizer: tiktoken cl100k_base token counting for the
//! analytics path. `encode_with_special_tokens` treats special-token strings as
//! single tokens, matching Go's `Encode(text, ["all"], nil)`. The encoder is
//! expensive to build, so it is cached once via OnceLock.
//!
//! No `DesktopAPI` slot: the frozen frontend estimates tokens itself
//! (`@shared/utils/tokenFormatting.estimateTokens`) and never calls the Go
//! `AnalyticsService.CountTokens`. This module exists for Go↔Rust module parity;
//! `count_tokens`/`count_tokens_batch` are never adapter-wired.

use std::sync::OnceLock;

use tiktoken_rs::CoreBPE;

/// Lazily initialized cl100k_base BPE tokenizer (same family as Claude models).
fn bpe() -> &'static CoreBPE {
    static BPE: OnceLock<CoreBPE> = OnceLock::new();
    BPE.get_or_init(|| {
        tiktoken_rs::cl100k_base().expect("Failed to initialize cl100k_base tokenizer")
    })
}

/// Count tokens in a string using tiktoken cl100k_base. Empty text -> 0.
pub fn count_tokens(text: &str) -> usize {
    if text.is_empty() {
        return 0;
    }
    bpe().encode_with_special_tokens(text).len()
}

/// Count tokens for multiple strings in a batch, reusing the cached encoder.
pub fn count_tokens_batch(texts: &[String]) -> Vec<usize> {
    let tokenizer = bpe();
    texts
        .iter()
        .map(|text| {
            if text.is_empty() {
                0
            } else {
                tokenizer.encode_with_special_tokens(text).len()
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_string_returns_zero() {
        assert_eq!(count_tokens(""), 0);
    }

    #[test]
    fn batch_tokenization_correct_counts() {
        let texts = vec!["Hello".to_string(), String::new(), "World".to_string()];
        let counts = count_tokens_batch(&texts);
        assert_eq!(counts.len(), 3);
        assert!(counts[0] > 0);
        assert_eq!(counts[1], 0);
        assert!(counts[2] > 0);
    }

    // Loads the committed tokenizer cases and asserts cl100k_base counts.
    #[test]
    fn tokenizer_matches_go_golden() {
        #[derive(serde::Deserialize)]
        struct Case {
            text: String,
            count: usize,
        }
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/parity/tokenizer_cases.json"
        );
        let raw = std::fs::read_to_string(path)
            .unwrap_or_else(|e| panic!("read committed tokenizer fixture {path}: {e}"));
        let cases: Vec<Case> = serde_json::from_str(&raw).expect("parse tokenizer_cases.json");
        assert!(!cases.is_empty(), "no tokenizer cases");
        for c in &cases {
            assert_eq!(
                count_tokens(&c.text),
                c.count,
                "token count mismatch for {:?}",
                c.text
            );
        }
    }
}
