/// Estimate token count: ~4 chars per token (ceiling).
pub fn estimate_tokens(content: &str) -> usize {
    (content.len() + 3) / 4
}

/// Format token count for display (e.g. 500, 1.5k, 15k).
pub(super) fn format_tokens(count: usize) -> String {
    if count < 1000 {
        count.to_string()
    } else {
        let k = count as f64 / 1000.0;
        if k < 10.0 {
            format!("{:.1}k", k)
        } else {
            format!("{:.0}k", k)
        }
    }
}

/// Parse ISO-8601 timestamp string to epoch milliseconds.
pub(super) fn parse_timestamp_ms(ts: &str) -> f64 {
    chrono::DateTime::parse_from_rfc3339(ts)
        .map(|dt| dt.timestamp_millis() as f64)
        .unwrap_or(0.0)
}
