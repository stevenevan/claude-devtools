package search

import (
	"strconv"
	"testing"
)

// TestParseSwap documents the contract for the stdlib replacements of the
// hand-rolled parseUint / parseFloat64 helpers.
//
// The old helpers silently truncated on the first non-digit; strconv returns an
// error for malformed input.  All call sites in search.go pre-validate their
// inputs (digit-only for parseUint, digit+dot for parseFloat64), so the
// behavioral difference only surfaces on garbage input — which this test
// documents explicitly.
func TestParseSwap(t *testing.T) {
	t.Run("ParseUint valid integer", func(t *testing.T) {
		n, err := strconv.ParseUint("42", 10, 64)
		if err != nil || n != 42 {
			t.Fatalf("want 42, got %d err %v", n, err)
		}
	})

	t.Run("ParseUint boundary zero", func(t *testing.T) {
		n, err := strconv.ParseUint("0", 10, 64)
		if err != nil || n != 0 {
			t.Fatalf("want 0, got %d err %v", n, err)
		}
	})

	t.Run("ParseUint malformed returns error", func(t *testing.T) {
		// Old hand-rolled helper stopped at first non-digit, returning partial
		// result.  strconv.ParseUint returns an error instead.
		_, err := strconv.ParseUint("12abc", 10, 64)
		if err == nil {
			t.Fatal("want error for malformed input, got nil")
		}
	})

	t.Run("ParseFloat valid decimal", func(t *testing.T) {
		v, err := strconv.ParseFloat("3.14", 64)
		if err != nil || v < 3.13 || v > 3.15 {
			t.Fatalf("want ~3.14, got %f err %v", v, err)
		}
	})

	t.Run("ParseFloat valid integer-like", func(t *testing.T) {
		v, err := strconv.ParseFloat("100", 64)
		if err != nil || v != 100.0 {
			t.Fatalf("want 100.0, got %f err %v", v, err)
		}
	})

	t.Run("ParseFloat malformed returns error", func(t *testing.T) {
		// Old hand-rolled helper would return &0 for garbage; strconv returns error.
		_, err := strconv.ParseFloat("not-a-number", 64)
		if err == nil {
			t.Fatal("want error for malformed input, got nil")
		}
	})
}
