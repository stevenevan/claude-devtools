//! Webhook delivery ported from `internal/notifications/webhook.go`:
//! template expansion, the SSRF allowlist, retry-with-backoff, and the real
//! HTTP dispatch (via `ureq` 3).
//!
//! SSRF hardening reproduced from the Go fix:
//!   1. `parse_url` rejects any authority containing `@` (userinfo). Otherwise
//!      `https://hooks.slack.com:443@127.0.0.1/x` passes the host allowlist while
//!      the client connects to `127.0.0.1`.
//!   2. The HTTP client does NOT follow redirects (`max_redirects(0)`) — a 3xx
//!      to an internal address would be a redirect-SSRF hole. `check_ssrf`
//!      validates only the initial URL.

use std::net::IpAddr;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};

const ALLOWED_DISCORD_PATH_PREFIXES: &[&str] = &["/api/webhooks/"];

const MAX_ATTEMPTS: u32 = 3;
const RETRY_DELAYS_MS: &[u64] = &[1000, 2000, 4000];

// ── Types ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WebhookEndpoint {
    pub id: String,
    pub label: String,
    pub url: String,
    pub template: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
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

/// Result of an HTTP attempt — drives the retry loop's back-off decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttemptOutcome {
    Success,
    Retryable,
    Permanent,
}

/// Abstracts the HTTP layer so tests can substitute a fake transport.
pub trait WebhookTransport: Send + Sync {
    fn send(&self, url: &str, body: &str) -> AttemptOutcome;
}

/// Counts attempts (mirrors `RetryStats`).
#[derive(Debug, Default)]
pub struct RetryStats {
    pub attempts: AtomicU32,
}

// ── SSRF allowlist ────────────────────────────────────────────────────────────

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
    false
}

fn ip_is_private(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local() // 169.254.0.0/16 (link-local unicast)
                || (o[0] == 224 && o[1] == 0 && o[2] == 0) // link-local multicast
                || o[0] == 0
                || (o[0] == 169 && o[1] == 254)
        }
        // IPv6: loopback, unspecified, or ULA (fc00::/7).
        IpAddr::V6(v6) => {
            v6.is_loopback() || v6.is_unspecified() || (v6.octets()[0] & 0xfe) == 0xfc
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
    // Reject userinfo: "user@host" would let the allowlist see an approved host
    // while the client connects to the part after '@' (SSRF bypass). No
    // legitimate webhook URL carries userinfo.
    if host_with_port.contains('@') {
        return Err(WebhookError::InvalidUrl(
            "userinfo not allowed in webhook URL".to_string(),
        ));
    }
    // Strip port. Only when there are no brackets (bracket ⇒ IPv6 literal).
    let host = if host_with_port.contains('[') {
        host_with_port
    } else {
        match host_with_port.rfind(':') {
            Some(i) => &host_with_port[..i],
            None => host_with_port,
        }
    };
    Ok(ParsedUrl { scheme, host, path })
}

/// Validates a URL against the SSRF allowlist (mirrors `webhook.go:CheckSSRF`).
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
    // Reject literal private/loopback/link-local/ULA IP hosts.
    if let Ok(ip) = parsed.host.parse::<IpAddr>() {
        if ip_is_private(ip) {
            return Err(WebhookError::SsrfRejected("literal IP host".to_string()));
        }
    }
    Ok(())
}

// ── Template expansion ────────────────────────────────────────────────────────

pub fn expand_template(template: &str, ctx: &WebhookContext) -> String {
    template
        .replace("{session_id}", &ctx.session_id)
        .replace("{tool}", &ctx.tool)
        .replace("{cost}", &format!("{:.4}", ctx.cost))
        .replace("{summary}", &ctx.summary)
}

// ── Retry loop ────────────────────────────────────────────────────────────────

/// Runs the transport with backoff. `sleeper` is injectable for tests.
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
            AttemptOutcome::Permanent => return Err(WebhookError::HttpStatus(0)),
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

/// Validates, expands the template, then dispatches (mirrors `DispatchWebhook`).
pub fn dispatch_webhook(
    transport: &dyn WebhookTransport,
    endpoint: &WebhookEndpoint,
    ctx: &WebhookContext,
) -> Result<(), WebhookError> {
    check_ssrf(&endpoint.url)?;
    let body = expand_template(&endpoint.template, ctx);
    let stats = RetryStats::default();
    dispatch_with_retry(
        transport,
        &endpoint.url,
        &body,
        &|d| std::thread::sleep(d),
        &stats,
    )
}

// ── Default (real) HTTP transport ─────────────────────────────────────────────

/// Sends a real POST using `ureq` 3. Redirects are NOT followed: `check_ssrf`
/// validates only the initial URL, so following a 3xx to an internal address
/// would be a redirect-SSRF hole.
pub struct HttpTransport {
    agent: ureq::Agent,
}

impl HttpTransport {
    /// Creates a transport with a 10-second timeout and redirects disabled
    /// (mirrors `webhook.go:NewHTTPTransport`).
    pub fn new() -> Self {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(10)))
            .max_redirects(0)
            .http_status_as_error(false)
            .build()
            .into();
        Self { agent }
    }
}

impl Default for HttpTransport {
    fn default() -> Self {
        Self::new()
    }
}

impl WebhookTransport for HttpTransport {
    fn send(&self, url: &str, body: &str) -> AttemptOutcome {
        match self
            .agent
            .post(url)
            .header("Content-Type", "application/json")
            .header("User-Agent", "claude-devtools/webhook")
            .send(body)
        {
            Ok(resp) => {
                let code = resp.status().as_u16();
                if (200..300).contains(&code) {
                    AttemptOutcome::Success
                } else if code >= 500 {
                    AttemptOutcome::Retryable
                } else {
                    AttemptOutcome::Permanent
                }
            }
            Err(_) => AttemptOutcome::Retryable,
        }
    }
}

#[cfg(test)]
#[path = "webhook_tests.rs"]
mod webhook_tests;
