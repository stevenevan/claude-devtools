package parsing

import (
	"time"

	"claude-devtools/internal/domain"
)

// CalculateMetrics mirrors metrics::calculate_metrics. Tokens are summed over
// requestId-deduped messages; duration spans all parseable timestamps; the
// primary model is the most frequent non-synthetic assistant model.
func CalculateMetrics(messages []domain.ParsedMessage) domain.SessionMetrics {
	if len(messages) == 0 {
		return domain.SessionMetrics{}
	}

	deduped := deduplicateByRequestID(messages)

	var inTok, outTok, crTok, ccTok uint64
	for _, m := range deduped {
		if m.Usage == nil {
			continue
		}
		inTok += m.Usage.InputTokens
		outTok += m.Usage.OutputTokens
		if m.Usage.CacheReadInputTokens != nil {
			crTok += *m.Usage.CacheReadInputTokens
		}
		if m.Usage.CacheCreationInputTokens != nil {
			ccTok += *m.Usage.CacheCreationInputTokens
		}
	}

	var ts []int64
	for _, m := range messages {
		if t, err := time.Parse(time.RFC3339, m.Timestamp); err == nil {
			ts = append(ts, t.UnixMilli())
		}
	}
	durationMs := 0.0
	if len(ts) >= 2 {
		mn, mx := ts[0], ts[0]
		for _, v := range ts {
			if v < mn {
				mn = v
			}
			if v > mx {
				mx = v
			}
		}
		durationMs = float64(mx - mn)
	}

	return domain.SessionMetrics{
		DurationMs:          durationMs,
		TotalTokens:         inTok + outTok + crTok + ccTok,
		InputTokens:         inTok,
		OutputTokens:        outTok,
		CacheReadTokens:     crTok,
		CacheCreationTokens: ccTok,
		MessageCount:        uint32(len(messages)),
		CostUsd:             nil,
		Model:               extractPrimaryModel(messages),
	}
}

// extractPrimaryModel returns the most frequent non-empty, non-synthetic
// assistant model. ponytail: tie-break follows Rust's nondeterministic
// HashMap.max_by_key; goldens have a dominant model so it's stable in practice.
func extractPrimaryModel(messages []domain.ParsedMessage) *string {
	counts := map[string]uint32{}
	for _, m := range messages {
		if m.MessageType != "assistant" || m.Model == nil {
			continue
		}
		mod := *m.Model
		if mod != "" && mod != "<synthetic>" {
			counts[mod]++
		}
	}
	var best string
	var bestN uint32
	found := false
	for mod, n := range counts {
		if !found || n > bestN {
			best, bestN, found = mod, n, true
		}
	}
	if !found {
		return nil
	}
	return &best
}
