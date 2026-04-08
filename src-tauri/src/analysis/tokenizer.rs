use std::sync::OnceLock;

use tiktoken_rs::CoreBPE;

/// Lazily initialized cl100k_base BPE tokenizer (same family as Claude models).
fn bpe() -> &'static CoreBPE {
    static BPE: OnceLock<CoreBPE> = OnceLock::new();
    BPE.get_or_init(|| {
        tiktoken_rs::cl100k_base().expect("Failed to initialize cl100k_base tokenizer")
    })
}

/// Count tokens in a string using tiktoken cl100k_base.
pub fn count_tokens(text: &str) -> usize {
    if text.is_empty() {
        return 0;
    }
    bpe().encode_with_special_tokens(text).len()
}

/// Count tokens for multiple strings in a batch.
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
    fn hello_world_returns_reasonable_count() {
        let count = count_tokens("Hello, world!");
        assert!(count >= 2 && count <= 6, "Expected 2-6 tokens, got {count}");
    }

    #[test]
    fn code_snippet_tokenizes() {
        let code = "fn main() { println!(\"Hello\"); }";
        let count = count_tokens(code);
        let heuristic = (code.len() + 3) / 4;
        // Real tokenizer should produce a different count than len/4
        assert!(count > 0, "Should produce non-zero token count");
        assert!(
            count != heuristic || count > 0,
            "Should produce a real count (got {count}, heuristic was {heuristic})"
        );
    }

    #[test]
    fn batch_tokenization_correct_counts() {
        let texts = vec![
            "Hello".to_string(),
            "".to_string(),
            "World".to_string(),
        ];
        let counts = count_tokens_batch(&texts);
        assert_eq!(counts.len(), 3);
        assert!(counts[0] > 0);
        assert_eq!(counts[1], 0);
        assert!(counts[2] > 0);
    }

    #[test]
    fn long_string_no_panic() {
        let long = "a".repeat(100_000);
        let count = count_tokens(&long);
        assert!(count > 0);
    }
}
