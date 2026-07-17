//! Token estimation, formatting, and timestamp helpers ported from
//! `internal/notifications/tokens.go`.

/// Estimates token count at ~4 chars per token (ceiling).
pub fn estimate_tokens(content: &str) -> i64 {
    ((content.len() + 3) / 4) as i64
}

/// Formats a token count for display (e.g. 500, 1.5k, 15k).
pub fn format_tokens(count: i64) -> String {
    if count < 1000 {
        return format!("{count}");
    }
    let k = count as f64 / 1000.0;
    if k < 10.0 {
        format!("{k:.1}k")
    } else {
        format!("{k:.0}k")
    }
}

/// Parses an ISO-8601 timestamp to epoch milliseconds; returns 0 on failure.
pub fn parse_timestamp_ms(ts: &str) -> f64 {
    match chrono::DateTime::parse_from_rfc3339(ts) {
        Ok(dt) => dt.timestamp_nanos_opt().unwrap_or(0) as f64 / 1e6,
        Err(_) => 0.0,
    }
}

/// Returns the current time as epoch milliseconds.
pub fn now_ms() -> f64 {
    chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0) as f64 / 1e6
}

#[cfg(test)]
#[path = "tokens_tests.rs"]
mod tests;
