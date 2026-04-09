/// SSH retry logic with exponential backoff for transient errors.

use std::time::Duration;

/// Configuration for SSH connection retries.
#[derive(Debug, Clone)]
pub struct RetryConfig {
    pub max_retries: u32,
    pub base_delay: Duration,
    pub max_delay: Duration,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_retries: 3,
            base_delay: Duration::from_secs(2),
            max_delay: Duration::from_secs(16),
        }
    }
}

/// Tracks the current retry state.
#[derive(Debug, Clone, Default)]
pub struct RetryState {
    pub attempt: u32,
    pub last_error: Option<String>,
}

impl RetryState {
    /// Compute the next delay using exponential backoff: base_delay * 2^attempt.
    pub fn next_delay(&self, config: &RetryConfig) -> Duration {
        let delay = config.base_delay.saturating_mul(1 << self.attempt);
        delay.min(config.max_delay)
    }

    /// Whether we can retry (haven't exhausted max_retries).
    pub fn can_retry(&self, config: &RetryConfig) -> bool {
        self.attempt < config.max_retries
    }

    /// Advance to the next attempt.
    pub fn advance(&mut self, error: String) {
        self.attempt += 1;
        self.last_error = Some(error);
    }

    /// Reset the retry state.
    pub fn reset(&mut self) {
        self.attempt = 0;
        self.last_error = None;
    }
}

/// Known transient error patterns that warrant retry.
static TRANSIENT_PATTERNS: &[&str] = &[
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
];

/// Check if an error message indicates a transient failure.
pub fn is_transient_error(error: &str) -> bool {
    let lower = error.to_lowercase();
    TRANSIENT_PATTERNS
        .iter()
        .any(|pattern| lower.contains(pattern))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_values() {
        let config = RetryConfig::default();
        assert_eq!(config.max_retries, 3);
        assert_eq!(config.base_delay, Duration::from_secs(2));
        assert_eq!(config.max_delay, Duration::from_secs(16));
    }

    #[test]
    fn exponential_delay_calculation() {
        let config = RetryConfig::default();
        let mut state = RetryState::default();

        // Attempt 0: 2s
        assert_eq!(state.next_delay(&config), Duration::from_secs(2));
        state.advance("error".to_string());

        // Attempt 1: 4s
        assert_eq!(state.next_delay(&config), Duration::from_secs(4));
        state.advance("error".to_string());

        // Attempt 2: 8s
        assert_eq!(state.next_delay(&config), Duration::from_secs(8));
        state.advance("error".to_string());

        // Attempt 3: 16s (capped at max_delay)
        assert_eq!(state.next_delay(&config), Duration::from_secs(16));
    }

    #[test]
    fn can_retry_respects_max() {
        let config = RetryConfig::default();
        let mut state = RetryState::default();

        assert!(state.can_retry(&config)); // 0 < 3
        state.advance("e".to_string());
        assert!(state.can_retry(&config)); // 1 < 3
        state.advance("e".to_string());
        assert!(state.can_retry(&config)); // 2 < 3
        state.advance("e".to_string());
        assert!(!state.can_retry(&config)); // 3 == 3
    }

    #[test]
    fn transient_error_detection() {
        assert!(is_transient_error("SSH connection failed: Connection refused"));
        assert!(is_transient_error("connection timed out after 30s"));
        assert!(is_transient_error("Broken pipe"));
        assert!(is_transient_error("Network unreachable"));
        assert!(is_transient_error("Host unreachable"));
        assert!(is_transient_error("Connection reset by peer"));
    }

    #[test]
    fn permanent_errors_not_transient() {
        assert!(!is_transient_error("Password authentication failed"));
        assert!(!is_transient_error("Permission denied (publickey)"));
        assert!(!is_transient_error("Invalid key format"));
        assert!(!is_transient_error("No such host"));
    }

    #[test]
    fn reset_clears_state() {
        let mut state = RetryState::default();
        state.advance("err1".to_string());
        state.advance("err2".to_string());
        assert_eq!(state.attempt, 2);
        assert!(state.last_error.is_some());

        state.reset();
        assert_eq!(state.attempt, 0);
        assert!(state.last_error.is_none());
    }
}
