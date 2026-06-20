// Tests ported from src-tauri/src/analytics/cost.rs #[cfg(test)] mod tests.
package analytics

import (
	"math"
	"testing"
)

func TestPricingDefaultsToSonnet(t *testing.T) {
	p := GetModelPricing("")
	if p.Input != 3e-06 {
		t.Errorf("input: got %v, want %v", p.Input, 3e-06)
	}
	if p.Output != 1.5e-05 {
		t.Errorf("output: got %v, want %v", p.Output, 1.5e-05)
	}
}

func TestPricingOpusNew(t *testing.T) {
	p := GetModelPricing("claude-opus-4-6-20260101")
	if p.Input != 5e-06 {
		t.Errorf("got %v, want 5e-06", p.Input)
	}
}

func TestPricingOpusOld(t *testing.T) {
	p := GetModelPricing("claude-3-opus-20240229")
	if p.Input != 1.5e-05 {
		t.Errorf("got %v, want 1.5e-05", p.Input)
	}
}

func TestPricingHaiku45(t *testing.T) {
	p := GetModelPricing("claude-haiku-4-5-20251001")
	if p.Input != 1e-06 {
		t.Errorf("got %v, want 1e-06", p.Input)
	}
}

func TestPricingHaiku35(t *testing.T) {
	p := GetModelPricing("claude-3-5-haiku-20241022")
	if p.Input != 8e-07 {
		t.Errorf("got %v, want 8e-07", p.Input)
	}
}

func TestPricingSonnetFallback(t *testing.T) {
	p := GetModelPricing("claude-sonnet-4-20250514")
	if p.Input != 3e-06 {
		t.Errorf("got %v, want 3e-06", p.Input)
	}
}

func TestEstimateCostZeroTokens(t *testing.T) {
	cost := EstimateCost("", 0, 0, 0, 0)
	if cost != 0.0 {
		t.Errorf("got %v, want 0.0", cost)
	}
}

func TestEstimateCostSonnet(t *testing.T) {
	cost := EstimateCost("claude-sonnet-4-20250514", 1000, 500, 0, 0)
	want := 0.0105
	if math.Abs(cost-want) > 1e-10 {
		t.Errorf("got %v, want %v", cost, want)
	}
}

func TestEstimateCostWithCache(t *testing.T) {
	cost := EstimateCost("", 0, 0, 1000, 500)
	want := 0.002175
	if math.Abs(cost-want) > 1e-10 {
		t.Errorf("got %v, want %v", cost, want)
	}
}

func TestDisplayNameSonnet(t *testing.T) {
	got := ModelDisplayName("claude-sonnet-4-20250514")
	if got != "Sonnet 4" {
		t.Errorf("got %q, want %q", got, "Sonnet 4")
	}
}

func TestDisplayNameOpusWithMinor(t *testing.T) {
	got := ModelDisplayName("claude-opus-4-6-20260101")
	if got != "Opus 4.6" {
		t.Errorf("got %q, want %q", got, "Opus 4.6")
	}
}

func TestDisplayNameHaiku45(t *testing.T) {
	got := ModelDisplayName("claude-haiku-4-5-20251001")
	if got != "Haiku 4.5" {
		t.Errorf("got %q, want %q", got, "Haiku 4.5")
	}
}

func TestDisplayNameUnknownModel(t *testing.T) {
	got := ModelDisplayName("gpt-4o")
	if got != "gpt-4o" {
		t.Errorf("got %q, want %q", got, "gpt-4o")
	}
}

func TestDisplayNameClaudePrefixStripped(t *testing.T) {
	got := ModelDisplayName("claude-unknown-model")
	if got != "unknown-model" {
		t.Errorf("got %q, want %q", got, "unknown-model")
	}
}
