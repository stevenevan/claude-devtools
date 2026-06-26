// Package analytics ports src-tauri/src/analytics/ to Go.
// This file: cost.rs — model pricing and cost estimation.
package analytics

import "strings"

// ModelPricing holds per-token prices in USD.
type ModelPricing struct {
	Input      float64
	Output     float64
	CacheRead  float64
	CacheWrite float64
}

// sonnetPricing is the fallback when no model is recognised.
var sonnetPricing = ModelPricing{Input: 3e-06, Output: 1.5e-05, CacheRead: 3e-07, CacheWrite: 3.75e-06}

// GetModelPricing resolves per-token pricing for a model string.
// Falls back to Sonnet pricing. Mirrors cost::get_model_pricing.
func GetModelPricing(model string) ModelPricing {
	lower := strings.ToLower(model)

	if strings.Contains(lower, "opus") {
		if strings.Contains(lower, "4-5") || strings.Contains(lower, "4.5") ||
			strings.Contains(lower, "4-6") || strings.Contains(lower, "4.6") {
			return ModelPricing{Input: 5e-06, Output: 2.5e-05, CacheRead: 5e-07, CacheWrite: 6.25e-06}
		}
		return ModelPricing{Input: 1.5e-05, Output: 7.5e-05, CacheRead: 1.5e-06, CacheWrite: 1.875e-05}
	}
	if strings.Contains(lower, "haiku") {
		if strings.Contains(lower, "4-5") || strings.Contains(lower, "4.5") {
			return ModelPricing{Input: 1e-06, Output: 5e-06, CacheRead: 1e-07, CacheWrite: 1.25e-06}
		}
		if strings.Contains(lower, "3-5") || strings.Contains(lower, "3.5") {
			return ModelPricing{Input: 8e-07, Output: 4e-06, CacheRead: 8e-08, CacheWrite: 1e-06}
		}
		return ModelPricing{Input: 2.5e-07, Output: 1.25e-06, CacheRead: 2.5e-08, CacheWrite: 3.125e-07}
	}
	return sonnetPricing
}

// EstimateCost returns the USD cost for the given token counts.
// model may be "" to use the sonnet fallback.
// Mirrors cost::estimate_cost.
func EstimateCost(model string, input, output, cacheRead, cacheCreation uint64) float64 {
	p := GetModelPricing(model)
	return float64(input)*p.Input +
		float64(output)*p.Output +
		float64(cacheRead)*p.CacheRead +
		float64(cacheCreation)*p.CacheWrite
}

// ModelDisplayName converts a model slug to a human-readable name.
// Mirrors cost::model_display_name.
func ModelDisplayName(model string) string {
	lower := strings.ToLower(model)
	for _, family := range []string{"opus", "sonnet", "haiku"} {
		idx := strings.Index(lower, family)
		if idx < 0 {
			continue
		}
		capitalized := strings.ToUpper(family[:1]) + family[1:]
		after := lower[idx+len(family):]

		// Parse major version number.
		i := 0
		for i < len(after) && !isDigit(after[i]) {
			i++
		}
		maj := ""
		for i < len(after) && isDigit(after[i]) {
			maj += string(after[i])
			i++
		}
		if maj == "" {
			return capitalized
		}

		// Skip separator, then parse minor version number.
		for i < len(after) && !isDigit(after[i]) {
			i++
		}
		min := ""
		for i < len(after) && isDigit(after[i]) {
			min += string(after[i])
			i++
		}
		// Minor only counts if it's 1–2 digits (matches Rust: buf.len() <= 2).
		if min != "" && len(min) <= 2 {
			return capitalized + " " + maj + "." + min
		}
		return capitalized + " " + maj
	}
	// Strip "claude-" prefix for unrecognised models.
	if s, ok := strings.CutPrefix(model, "claude-"); ok {
		return s
	}
	return model
}

func isDigit(b byte) bool { return b >= '0' && b <= '9' }
