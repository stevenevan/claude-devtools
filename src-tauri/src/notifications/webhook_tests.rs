//! Ports the `webhook.rs` cases from `notifications_test.go`: SSRF allowlist
//! (incl. the adversarial userinfo-bypass cases), template expansion, retry
//! backoff, and dispatch. Uses a fake transport — no real network.

use super::*;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

struct FakeTransport {
    outcomes: Vec<AttemptOutcome>,
    index: AtomicU32,
}

impl FakeTransport {
    fn new(outcomes: Vec<AttemptOutcome>) -> Self {
        Self {
            outcomes,
            index: AtomicU32::new(0),
        }
    }
}

impl WebhookTransport for FakeTransport {
    fn send(&self, _url: &str, _body: &str) -> AttemptOutcome {
        let idx = self.index.fetch_add(1, Ordering::SeqCst) as usize;
        self.outcomes.get(idx).copied().unwrap_or(AttemptOutcome::Retryable)
    }
}

fn no_sleep(_d: Duration) {}

// ── SSRF allowlist ────────────────────────────────────────────────────────────

#[test]
fn ssrf_rejects_private_and_metadata() {
    let cases = [
        "http://10.0.0.1/x",
        "https://169.254.169.254/",
        "https://example.com/hook",
        // Userinfo bypass: allowlist would see "hooks.slack.com" while the client
        // connects to 127.0.0.1 / the metadata IP. Must be rejected.
        "https://hooks.slack.com:443@127.0.0.1/api/webhooks/x",
        "https://hooks.slack.com@169.254.169.254/",
    ];
    for url in cases {
        assert!(check_ssrf(url).is_err(), "CheckSSRF({url:?}) should have been rejected");
    }
}

#[test]
fn ssrf_accepts_slack_and_discord() {
    let cases = [
        "https://hooks.slack.com/services/abc/def",
        "https://discord.com/api/webhooks/123/token",
        "https://discordapp.com/api/webhooks/123/token",
    ];
    for url in cases {
        assert!(check_ssrf(url).is_ok(), "CheckSSRF({url:?}) should be OK");
    }
}

// ── Template expansion ────────────────────────────────────────────────────────

#[test]
fn template_expansion_replaces_placeholders() {
    let ctx = WebhookContext {
        session_id: "s1".into(),
        tool: "Bash".into(),
        cost: 0.5,
        summary: "Done".into(),
    };
    let body = expand_template(
        r#"{"sid":"{session_id}","tool":"{tool}","cost":{cost},"sum":"{summary}"}"#,
        &ctx,
    );
    assert_eq!(body, r#"{"sid":"s1","tool":"Bash","cost":0.5000,"sum":"Done"}"#);
}

// ── Retry loop ────────────────────────────────────────────────────────────────

#[test]
fn retry_succeeds_after_one_retryable() {
    let transport = FakeTransport::new(vec![AttemptOutcome::Retryable, AttemptOutcome::Success]);
    let stats = RetryStats::default();
    let res = dispatch_with_retry(&transport, "https://hooks.slack.com/x", "{}", &no_sleep, &stats);
    assert!(res.is_ok());
    assert_eq!(stats.attempts.load(Ordering::SeqCst), 2);
}

#[test]
fn retry_fails_after_three_retryable() {
    let transport = FakeTransport::new(vec![
        AttemptOutcome::Retryable,
        AttemptOutcome::Retryable,
        AttemptOutcome::Retryable,
    ]);
    let stats = RetryStats::default();
    let res = dispatch_with_retry(&transport, "https://hooks.slack.com/x", "{}", &no_sleep, &stats);
    assert!(res.is_err());
    assert_eq!(stats.attempts.load(Ordering::SeqCst), 3);
}

#[test]
fn permanent_outcome_does_not_retry() {
    let transport = FakeTransport::new(vec![AttemptOutcome::Permanent]);
    let stats = RetryStats::default();
    let res = dispatch_with_retry(&transport, "https://hooks.slack.com/x", "{}", &no_sleep, &stats);
    assert!(res.is_err());
    assert_eq!(stats.attempts.load(Ordering::SeqCst), 1);
}

#[test]
fn dispatch_webhook_ssrf_blocked() {
    let endpoint = WebhookEndpoint {
        id: "e1".into(),
        label: "blocked".into(),
        url: "https://example.com/hook".into(),
        template: "{}".into(),
    };
    let ctx = WebhookContext::default();
    let transport = FakeTransport::new(vec![AttemptOutcome::Success]);
    let res = dispatch_webhook(&transport, &endpoint, &ctx);
    assert!(matches!(res, Err(WebhookError::SsrfRejected(_))), "expected SSRF rejection");
}
