//! Permissions analyzer (W30): mines the user's OWN structured tool_use records
//! to SUGGEST permission-allow rules.
//!
//! Security-critical invariant: suggestions derive ONLY from structured
//! `tool_use` records (things a session actually invoked) — NEVER from
//! conversation free text, message content, or history.jsonl. Nothing is ever
//! written (suggestions only); the claude root is threaded by the caller.
mod analyzer;
mod rules;

pub use analyzer::{analyze_usage, Suggestion};
