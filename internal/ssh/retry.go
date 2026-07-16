// Package ssh — retry.go.
// Exponential back-off with transient-error detection. PURE — no I/O.
package ssh

import (
	"strings"
	"time"
)

// RetryConfig mirrors RetryConfig.
type RetryConfig struct {
	MaxRetries uint32
	BaseDelay  time.Duration
	MaxDelay   time.Duration
}

// DefaultRetryConfig mirrors RetryConfig::default.
func DefaultRetryConfig() RetryConfig {
	return RetryConfig{
		MaxRetries: 3,
		BaseDelay:  2 * time.Second,
		MaxDelay:   16 * time.Second,
	}
}

// RetryState mirrors RetryState.
type RetryState struct {
	Attempt   uint32
	LastError *string
}

// NextDelay mirrors RetryState::next_delay — base_delay * 2^attempt, capped.
func (rs *RetryState) NextDelay(cfg RetryConfig) time.Duration {
	// Saturating left-shift: 1 << attempt, but cap at MaxDelay before the
	// multiplication overflows.  max shift is 30 to stay within int64.
	shift := rs.Attempt
	if shift > 30 {
		shift = 30
	}
	d := cfg.BaseDelay * (1 << shift)
	if d > cfg.MaxDelay {
		d = cfg.MaxDelay
	}
	return d
}

// CanRetry mirrors RetryState::can_retry.
func (rs *RetryState) CanRetry(cfg RetryConfig) bool {
	return rs.Attempt < cfg.MaxRetries
}

// Advance mirrors RetryState::advance.
func (rs *RetryState) Advance(err string) {
	rs.Attempt++
	rs.LastError = &err
}

// Reset mirrors RetryState::reset.
func (rs *RetryState) Reset() {
	rs.Attempt = 0
	rs.LastError = nil
}

// transientPatterns mirrors TRANSIENT_PATTERNS.
var transientPatterns = []string{
	"timeout",
	"timed out",
	"connection refused",
	"connection reset",
	"broken pipe",
	"network unreachable",
	"host unreachable",
	"no route to host",
	"connection aborted",
	"temporarily unavailable",
	"server busy",
	"eof",
}

// IsTransientError mirrors is_transient_error.
func IsTransientError(errMsg string) bool {
	lower := strings.ToLower(errMsg)
	for _, p := range transientPatterns {
		if strings.Contains(lower, p) {
			return true
		}
	}
	return false
}
