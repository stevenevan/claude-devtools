//! `notifications` — trigger matching, error detection, notification store, and
//! webhook delivery ported from `internal/notifications` (W14). The webhook
//! SSRF allowlist rejects userinfo + disables redirects (matches the Go fix).
pub mod checks;
pub mod error_detector;
pub mod extraction;
pub mod manager;
pub mod tokens;
pub mod tool_maps;
pub mod trigger_matcher;
pub mod trigger_tester;
pub mod types;
pub mod webhook;
