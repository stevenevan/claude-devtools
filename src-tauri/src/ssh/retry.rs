//! SSH retry — exponential back-off with transient-error detection, plus the
//! `Dialer` seam (mirrors Go's `NetDialer` injected into `ConnectWithRetry`) so
//! the retry loop is testable with a fake dialer. Back-off math reconciled
//! against the Go oracle `internal/ssh/retry.go`.

use std::future::Future;
use std::time::Duration;

use super::types::ConnectionConfig;

/// Mirrors Go `RetryConfig`.
#[derive(Debug, Clone)]
pub struct RetryConfig {
    pub max_retries: u32,
    pub base_delay: Duration,
    pub max_delay: Duration,
}

/// Mirrors Go `DefaultRetryConfig` — 3 retries, 2s base, 16s cap.
pub fn default_retry_config() -> RetryConfig {
    RetryConfig {
        max_retries: 3,
        base_delay: Duration::from_secs(2),
        max_delay: Duration::from_secs(16),
    }
}

impl Default for RetryConfig {
    fn default() -> Self {
        default_retry_config()
    }
}

/// Mirrors Go `RetryState`.
#[derive(Debug, Clone, Default)]
pub struct RetryState {
    pub attempt: u32,
    pub last_error: Option<String>,
}

impl RetryState {
    /// Mirrors Go `NextDelay` — `base_delay * 2^attempt`, capped at `max_delay`.
    /// Shift is capped at 30 (matches Go) to avoid overflow.
    pub fn next_delay(&self, config: &RetryConfig) -> Duration {
        let shift = self.attempt.min(30);
        let delay = config.base_delay.saturating_mul(1u32 << shift);
        delay.min(config.max_delay)
    }

    /// Mirrors Go `CanRetry`.
    pub fn can_retry(&self, config: &RetryConfig) -> bool {
        self.attempt < config.max_retries
    }

    /// Mirrors Go `Advance`.
    pub fn advance(&mut self, error: String) {
        self.attempt += 1;
        self.last_error = Some(error);
    }

    /// Mirrors Go `Reset`.
    pub fn reset(&mut self) {
        self.attempt = 0;
        self.last_error = None;
    }
}

/// Mirrors Go `transientPatterns`.
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

/// Mirrors Go `IsTransientError`.
pub fn is_transient_error(error: &str) -> bool {
    let lower = error.to_lowercase();
    TRANSIENT_PATTERNS.iter().any(|p| lower.contains(p))
}

/// The connection-attempt seam. Mirrors Go's injected `Dialer` (production
/// `NetDialer`, fake in tests). Keeping it generic makes `connect_with_retry`
/// testable without a live socket.
pub trait Dialer {
    type Conn;
    fn connect(
        &self,
        config: &ConnectionConfig,
    ) -> impl Future<Output = Result<Self::Conn, String>>;
}

/// Mirrors Go `ConnectWithRetry` — retries transient failures with back-off.
/// `on_retry(attempt, max_retries, err)` fires before each sleep so the caller
/// (main.rs) can emit `ssh-status` events.
pub async fn connect_with_retry<D, F>(
    config: &ConnectionConfig,
    retry_config: &RetryConfig,
    dialer: &D,
    mut on_retry: F,
) -> Result<D::Conn, String>
where
    D: Dialer,
    F: FnMut(u32, u32, &str),
{
    let mut state = RetryState::default();
    loop {
        match dialer.connect(config).await {
            Ok(conn) => return Ok(conn),
            Err(e) => {
                if !is_transient_error(&e) || !state.can_retry(retry_config) {
                    return Err(e);
                }
                let delay = state.next_delay(retry_config);
                state.advance(e.clone());
                on_retry(state.attempt, retry_config.max_retries, &e);
                tokio::time::sleep(delay).await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> ConnectionConfig {
        ConnectionConfig {
            host: "h".to_string(),
            port: 22,
            username: "u".to_string(),
            auth_method: "password".to_string(),
            password: Some("p".to_string()),
            private_key_path: None,
        }
    }

    struct AlwaysErr(String);
    impl Dialer for AlwaysErr {
        type Conn = ();
        async fn connect(&self, _config: &ConnectionConfig) -> Result<(), String> {
            Err(self.0.clone())
        }
    }

    // Zero-delay config so the loop's sleeps are instant (tokio `test-util` /
    // `start_paused` is not enabled). The real back-off math is asserted
    // separately in `exponential_delay_sequence`.
    fn instant_retry_config() -> RetryConfig {
        RetryConfig {
            max_retries: 3,
            base_delay: Duration::ZERO,
            max_delay: Duration::ZERO,
        }
    }

    #[test]
    fn default_config_values() {
        let c = default_retry_config();
        assert_eq!(c.max_retries, 3);
        assert_eq!(c.base_delay, Duration::from_secs(2));
        assert_eq!(c.max_delay, Duration::from_secs(16));
    }

    // GOLDEN: the back-off delay sequence 2s, 4s, 8s, 16s (capped) — matches Go
    // TestExponentialDelayCalculation.
    #[test]
    fn exponential_delay_sequence() {
        let config = default_retry_config();
        let mut state = RetryState::default();
        for want in [2u64, 4, 8, 16] {
            assert_eq!(state.next_delay(&config), Duration::from_secs(want));
            state.advance("e".to_string());
        }
    }

    #[test]
    fn can_retry_respects_max() {
        let config = default_retry_config();
        let mut state = RetryState::default();
        for _ in 0..config.max_retries {
            assert!(state.can_retry(&config));
            state.advance("e".to_string());
        }
        assert!(!state.can_retry(&config));
    }

    #[test]
    fn transient_vs_permanent() {
        for msg in [
            "SSH connection failed: Connection refused",
            "connection timed out after 30s",
            "Broken pipe",
            "Network unreachable",
            "Host unreachable",
            "Connection reset by peer",
        ] {
            assert!(is_transient_error(msg), "{msg}");
        }
        for msg in [
            "Password authentication failed",
            "Permission denied (publickey)",
            "Invalid key format",
            "No such host",
        ] {
            assert!(!is_transient_error(msg), "{msg}");
        }
    }

    #[test]
    fn reset_clears_state() {
        let mut state = RetryState::default();
        state.advance("e1".to_string());
        state.advance("e2".to_string());
        assert_eq!(state.attempt, 2);
        state.reset();
        assert_eq!(state.attempt, 0);
        assert!(state.last_error.is_none());
    }

    // The retry loop drives the fake dialer: 3 transient failures → 3 on_retry
    // callbacks (attempts 1..=3, max 3) → give up. Mirrors Go's dialer-seam retry test.
    #[tokio::test]
    async fn retry_loop_backs_off_then_gives_up_on_transient() {
        let cfg = test_config();
        let dialer = AlwaysErr("connection refused".to_string());
        let mut calls: Vec<(u32, u32)> = Vec::new();
        let res = connect_with_retry(&cfg, &instant_retry_config(), &dialer, |a, m, _e| {
            calls.push((a, m))
        })
        .await;
        assert!(res.is_err());
        assert_eq!(calls, vec![(1, 3), (2, 3), (3, 3)]);
    }

    #[tokio::test]
    async fn retry_loop_gives_up_immediately_on_permanent() {
        let cfg = test_config();
        let dialer = AlwaysErr("permission denied (publickey)".to_string());
        let mut count = 0u32;
        let res = connect_with_retry(&cfg, &instant_retry_config(), &dialer, |_, _, _| count += 1)
            .await;
        assert!(res.is_err());
        assert_eq!(count, 0);
    }
}
