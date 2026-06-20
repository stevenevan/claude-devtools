package tokenizer

import (
	"strings"
	"testing"
)

func TestEmptyStringReturnsZero(t *testing.T) {
	if got := CountTokens(""); got != 0 {
		t.Errorf("CountTokens(empty) = %d, want 0", got)
	}
}

// Golden counts verified equal to tiktoken-rs cl100k_base (the parity target).
func TestGoldenCounts(t *testing.T) {
	cases := map[string]int{
		"Hello, world!":                     4,
		"fn main() { println!(\"Hello\"); }": 9,
		"Hello":                             1,
		"World":                             1,
		"🚀 emoji café":                      5,
	}
	for text, want := range cases {
		if got := CountTokens(text); got != want {
			t.Errorf("CountTokens(%q) = %d, want %d (tiktoken-rs parity)", text, got, want)
		}
	}
}

func TestBatchTokenization(t *testing.T) {
	counts := CountTokensBatch([]string{"Hello", "", "World"})
	if len(counts) != 3 {
		t.Fatalf("len = %d, want 3", len(counts))
	}
	if counts[0] != 1 || counts[1] != 0 || counts[2] != 1 {
		t.Errorf("counts = %v, want [1 0 1]", counts)
	}
}

func TestLongStringNoPanic(t *testing.T) {
	long := strings.Repeat("a", 100_000)
	if got := CountTokens(long); got <= 0 {
		t.Errorf("CountTokens(long) = %d, want > 0", got)
	}
}
