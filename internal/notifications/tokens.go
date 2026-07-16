// tokens.go.
package notifications

import (
	"fmt"
	"time"
)

// EstimateTokens estimates token count at ~4 chars per token (ceiling).
// Mirrors trigger_checker/tokens.rs::estimate_tokens.
func EstimateTokens(content string) int {
	return (len(content) + 3) / 4
}

// FormatTokens formats a token count for display (e.g. 500, 1.5k, 15k).
// Mirrors trigger_checker/tokens.rs::format_tokens.
func FormatTokens(count int) string {
	if count < 1000 {
		return fmt.Sprintf("%d", count)
	}
	k := float64(count) / 1000.0
	if k < 10.0 {
		return fmt.Sprintf("%.1fk", k)
	}
	return fmt.Sprintf("%.0fk", k)
}

// ParseTimestampMS parses an ISO-8601 timestamp string to epoch milliseconds.
// Mirrors trigger_checker/tokens.rs::parse_timestamp_ms.
func ParseTimestampMS(ts string) float64 {
	t, err := time.Parse(time.RFC3339Nano, ts)
	if err != nil {
		t, err = time.Parse(time.RFC3339, ts)
		if err != nil {
			return 0
		}
	}
	return float64(t.UnixNano()) / 1e6
}

// NowMS returns the current time as epoch milliseconds.
func NowMS() float64 {
	return float64(time.Now().UnixNano()) / 1e6
}
