// Package tokenizer ports analysis/tokenizer.rs: tiktoken cl100k_base token
// counting for the analytics path. (The parity-gate path uses a separate
// len/4 estimate inside semantic_step_extractor — NOT this.) The encoder is
// expensive to build, so it is cached once via sync.Once.
//
// `Encode(text, ["all"], nil)` treats special-token strings as single tokens,
// matching tiktoken-rs `encode_with_special_tokens`.
package tokenizer

import (
	"sync"

	tiktoken "github.com/weaviate/tiktoken-go"
)

var (
	enc     *tiktoken.Tiktoken
	encOnce sync.Once
	encErr  error
)

func bpe() (*tiktoken.Tiktoken, error) {
	encOnce.Do(func() {
		enc, encErr = tiktoken.GetEncoding("cl100k_base")
	})
	return enc, encErr
}

var allSpecial = []string{"all"}

// CountTokens counts tokens in text using cl100k_base. Empty text → 0.
func CountTokens(text string) int {
	if text == "" {
		return 0
	}
	e, err := bpe()
	if err != nil {
		return 0
	}
	return len(e.Encode(text, allSpecial, nil))
}

// CountTokensBatch counts tokens for each string (empty → 0), reusing the
// cached encoder.
func CountTokensBatch(texts []string) []int {
	out := make([]int, len(texts))
	e, err := bpe()
	if err != nil {
		return out
	}
	for i, text := range texts {
		if text != "" {
			out[i] = len(e.Encode(text, allSpecial, nil))
		}
	}
	return out
}
