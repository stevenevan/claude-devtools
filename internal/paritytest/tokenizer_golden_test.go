package paritytest

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"claude-devtools/internal/tokenizer"
)

// tokenizerCasesPath is shared with the Rust cargo test
// (src-tauri/src/tokenizer.rs::tokenizer_matches_go_golden), which loads the
// same JSON and asserts count_tokens(text) == count for every case. This is the
// W08 premise gate: it proves the Rust tiktoken-rs cl100k_base counts match Go's
// weaviate/tiktoken-go before any token method is wired.
const tokenizerCasesPath = "testdata/tokenizer_cases.json"

// tokenizerCases are synthetic strings only — never real ~/.claude content.
// Covers: empty, ascii, unicode, code, tiktoken special-token string, whitespace,
// long repetition.
var tokenizerCases = []string{
	"",
	"Hello, world!",
	"The quick brown fox jumps over the lazy dog.",
	"café — naïve — 日本語 — 🚀 — Ω≈ç√∫",
	"fn main() { println!(\"Hello\"); }\n\tlet x: u32 = 42;",
	"<|endoftext|>",
	"prefix <|endoftext|> suffix",
	"   \n\t  multiple   spaces\tand\ttabs\n\n",
	"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
}

type tokenizerCase struct {
	Text  string `json:"text"`
	Count int    `json:"count"`
}

// TestTokenizerGolden generates (GEN_GOLDENS=1) or verifies the shared
// tokenizer_cases.json against the current Go tokenizer. The Rust side asserts
// the same file, so a green run on both sides closes the premise gate.
func TestTokenizerGolden(t *testing.T) {
	cases := make([]tokenizerCase, len(tokenizerCases))
	for i, text := range tokenizerCases {
		cases[i] = tokenizerCase{Text: text, Count: tokenizer.CountTokens(text)}
	}
	got, err := json.MarshalIndent(cases, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	golden := filepath.Clean(tokenizerCasesPath)
	if os.Getenv("GEN_GOLDENS") == "1" {
		if err := os.WriteFile(golden, append(got, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
		t.Logf("wrote %s", golden)
		return
	}
	want, err := os.ReadFile(golden)
	if err != nil {
		t.Fatalf("read golden (GEN_GOLDENS=1 to create): %v", err)
	}
	if g, w := canon(t, got), canon(t, want); g != w {
		t.Errorf("tokenizer golden mismatch\n got: %s\nwant: %s", g, w)
	}
}
