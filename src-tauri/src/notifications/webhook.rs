/// Webhook dispatch for notification rules (sprint 41).
///
/// Ships templating, SSRF allowlist, and retry-with-backoff as standalone
/// pure logic. The actual HTTP send is encapsulated in `WebhookTransport`
/// — the default transport is a logging stub (no `reqwest` direct
/// dependency yet); tests substitute a fake transport.

use std::net::IpAddr;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};

const ALLOWED_HOST_SUFFIXES: &[&str] = &["hooks.slack.com", "discord.com", "discordapp.com"];
const ALLOWED_DISCORD_PATH_PREFIXES: &[&str] = &["/api/webhooks/"];

const RETRY_DELAYS_MS: &[u64] = &[1000, 2000, 4000];
const MAX_ATTEMPTS: u32 = 3;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WebhookEndpoint {
    pub id: String,
    pub label: String,
    pub url: String,
    pub template: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookContext {
    pub session_id: String,
    pub tool: String,
    pub cost: f64,
    pub summary: String,
}

#[derive(Debug)]
pub enum WebhookError {
    SsrfRejected(String),
    InvalidUrl(String),
    HttpStatus(u16),
    NetworkFailure(String),
}

impl std::fmt::Display for WebhookError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WebhookError::SsrfRejected(why) => write!(f, "SSRF guard rejected: {why}"),
            WebhookError::InvalidUrl(why) => write!(f, "Invalid URL: {why}"),
            WebhookError::HttpStatus(code) => write!(f, "HTTP {code}"),
            WebhookError::NetworkFailure(why) => write!(f, "Network: {why}"),
        }
    }
}

impl std::error::Error for WebhookError {}

/// Result of an HTTP attempt — used by the retry loop to decide
/// whether to back off.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttemptOutcome {
    Success,
    Retryable,
    Permanent,
}

pub trait WebhookTransport: Send + Sync {
    fn send(&self, url: &str, body: &str) -> AttemptOutcome;
}

/// Default transport — does not actually send the request. Logs the
/// payload to stderr so dev builds can verify wiring. A future change
/// swaps this for a real `reqwest::Client` once the registry is
/// available.
pub struct LoggingTransport;

impl WebhookTransport for LoggingTransport {
    fn send(&self, url: &str, body: &str) -> AttemptOutcome {
        tracing::info!(target: "webhook", url = %url, byte_len = body.len(), "webhook POST (logging transport)");
        AttemptOutcome::Success
    }
}

// ----- Template expansion -----

pub fn expand_template(template: &str, ctx: &WebhookContext) -> String {
    template
        .replace("{session_id}", &ctx.session_id)
        .replace("{tool}", &ctx.tool)
        .replace("{cost}", &format!("{:.4}", ctx.cost))
        .replace("{summary}", &ctx.summary)
}

// ----- SSRF allowlist -----

fn host_allowed(host: &str, path: &str) -> bool {
    let host_lc = host.to_ascii_lowercase();
    if host_lc == "hooks.slack.com" {
        return true;
    }
    if host_lc == "discord.com" || host_lc == "discordapp.com" {
        return ALLOWED_DISCORD_PATH_PREFIXES
            .iter()
            .any(|prefix| path.starts_with(prefix));
    }
    let _ = ALLOWED_HOST_SUFFIXES; // visible reference
    false
}

fn ip_is_private(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let octets = v4.octets();
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_broadcast()
                || octets[0] == 0
                || (octets[0] == 169 && octets[1] == 254)
        }
        IpAddr::V6(v6) => {
            v6.is_loopback() || v6.is_unspecified() || (v6.segments()[0] & 0xfe00) == 0xfc00
        }
    }
}

#[derive(Debug)]
struct ParsedUrl<'a> {
    scheme: &'a str,
    host: &'a str,
    path: &'a str,
}

fn parse_url(url: &str) -> Result<ParsedUrl<'_>, WebhookError> {
    let (scheme, rest) = url
        .split_once("://")
        .ok_or_else(|| WebhookError::InvalidUrl("missing scheme".to_string()))?;
    if scheme != "https" && scheme != "http" {
        return Err(WebhookError::InvalidUrl(format!("scheme {scheme} not allowed")));
    }
    let (host_with_port, path) = match rest.find('/') {
        Some(idx) => (&rest[..idx], &rest[idx..]),
        None => (rest, "/"),
    };
    let host = host_with_port.split(':').next().unwrap_or(host_with_port);
    Ok(ParsedUrl { scheme, host, path })
}

pub fn check_ssrf(url: &str) -> Result<(), WebhookError> {
    let parsed = parse_url(url)?;
    if parsed.scheme == "http" {
        return Err(WebhookError::SsrfRejected("http scheme blocked".to_string()));
    }
    if !host_allowed(parsed.host, parsed.path) {
        return Err(WebhookError::SsrfRejected(format!(
            "host {} not on allowlist",
            parsed.host
        )));
    }
    if let Ok(ip) = parsed.host.parse::<IpAddr>() {
        if ip_is_private(ip) {
            return Err(WebhookError::SsrfRejected("literal IP host".to_string()));
        }
    }
    Ok(())
}

// ----- Retry loop -----

#[derive(Debug, Default)]
pub struct RetryStats {
    pub attempts: AtomicU32,
}

pub fn dispatch_with_retry(
    transport: &dyn WebhookTransport,
    url: &str,
    body: &str,
    sleeper: &dyn Fn(Duration),
    stats: &RetryStats,
) -> Result<(), WebhookError> {
    for attempt in 0..MAX_ATTEMPTS {
        stats.attempts.fetch_add(1, Ordering::SeqCst);
        match transport.send(url, body) {
            AttemptOutcome::Success => return Ok(()),
            AttemptOutcome::Permanent => {
                return Err(WebhookError::HttpStatus(0));
            }
            AttemptOutcome::Retryable => {
                if attempt + 1 >= MAX_ATTEMPTS {
                    return Err(WebhookError::NetworkFailure(
                        "Exceeded max retry attempts".to_string(),
                    ));
                }
                let delay = RETRY_DELAYS_MS.get(attempt as usize).copied().unwrap_or(4000);
                sleeper(Duration::from_millis(delay));
            }
        }
    }
    Err(WebhookError::NetworkFailure("retry exhausted".to_string()))
}

pub fn dispatch_webhook(
    transport: &dyn WebhookTransport,
    endpoint: &WebhookEndpoint,
    ctx: &WebhookContext,
) -> Result<(), WebhookError> {
    check_ssrf(&endpoint.url)?;
    let body = expand_template(&endpoint.template, ctx);
    let stats = RetryStats::default();
    dispatch_with_retry(transport, &endpoint.url, &body, &|d| std::thread::sleep(d), &stats)
}

// ----- Tauri commands -----

#[tauri::command]
pub fn webhook_test_send(endpoint: WebhookEndpoint) -> Result<(), String> {
    let ctx = WebhookContext {
        session_id: "test-session".to_string(),
        tool: "Bash".to_string(),
        cost: 0.0123,
        summary: "Test webhook from claude-devtools".to_string(),
    };
    dispatch_webhook(&LoggingTransport, &endpoint, &ctx).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;

    fn no_sleep() -> impl Fn(Duration) {
        |_d| {}
    }

    struct FakeTransport {
        outcomes: Vec<AttemptOutcome>,
        index: AtomicU32,
    }

    impl FakeTransport {
        fn new(outcomes: Vec<AttemptOutcome>) -> Self {
            Self { outcomes, index: AtomicU32::new(0) }
        }
    }

    impl WebhookTransport for FakeTransport {
        fn send(&self, _url: &str, _body: &str) -> AttemptOutcome {
            let idx = self.index.fetch_add(1, Ordering::SeqCst) as usize;
            self.outcomes.get(idx).copied().unwrap_or(AttemptOutcome::Retryable)
        }
    }

    #[test]
    fn ssrf_rejects_private_and_metadata_addresses() {
        // Plain http blocked outright
        assert!(check_ssrf("http://10.0.0.1/x").is_err());
        // 169.254 metadata address (literal IP)
        assert!(check_ssrf("https://169.254.169.254/").is_err());
        // Random host not on allowlist
        assert!(check_ssrf("https://example.com/hook").is_err());
    }

    #[test]
    fn ssrf_accepts_slack_and_discord() {
        assert!(check_ssrf("https://hooks.slack.com/services/abc/def").is_ok());
        assert!(check_ssrf("https://discord.com/api/webhooks/123/token").is_ok());
        assert!(check_ssrf("https://discordapp.com/api/webhooks/123/token").is_ok());
    }

    #[test]
    fn template_expansion_replaces_known_placeholders() {
        let ctx = WebhookContext {
            session_id: "s1".into(),
            tool: "Bash".into(),
            cost: 0.5,
            summary: "Done".into(),
        };
        let body = expand_template(
            "{\"sid\":\"{session_id}\",\"tool\":\"{tool}\",\"cost\":{cost},\"sum\":\"{summary}\"}",
            &ctx,
        );
        assert_eq!(
            body,
            "{\"sid\":\"s1\",\"tool\":\"Bash\",\"cost\":0.5000,\"sum\":\"Done\"}"
        );
    }

    #[test]
    fn retry_succeeds_after_one_retryable_attempt() {
        let transport = FakeTransport::new(vec![
            AttemptOutcome::Retryable,
            AttemptOutcome::Success,
        ]);
        let stats = RetryStats::default();
        let res = dispatch_with_retry(&transport, "https://hooks.slack.com/x", "{}", &no_sleep(), &stats);
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
        let res = dispatch_with_retry(&transport, "https://hooks.slack.com/x", "{}", &no_sleep(), &stats);
        assert!(res.is_err());
        assert_eq!(stats.attempts.load(Ordering::SeqCst), MAX_ATTEMPTS);
    }

    #[test]
    fn permanent_outcome_does_not_retry() {
        let transport = FakeTransport::new(vec![AttemptOutcome::Permanent]);
        let stats = RetryStats::default();
        let res = dispatch_with_retry(&transport, "https://hooks.slack.com/x", "{}", &no_sleep(), &stats);
        assert!(res.is_err());
        assert_eq!(stats.attempts.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn dispatch_webhook_runs_ssrf_then_retry() {
        // Endpoint blocked by SSRF — never reaches transport.
        let endpoint = WebhookEndpoint {
            id: "e1".into(),
            label: "blocked".into(),
            url: "https://example.com/hook".into(),
            template: "{}".into(),
        };
        let ctx = WebhookContext::default();
        let res = dispatch_webhook(&LoggingTransport, &endpoint, &ctx);
        assert!(matches!(res, Err(WebhookError::SsrfRejected(_))));
        let _ = Arc::new(()); // silence unused import on some toolchains
    }
}
