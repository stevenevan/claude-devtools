/// Signed millisecond difference between two ISO-8601 (RFC-3339) timestamps.
///
/// Unparseable inputs contribute `0.0`. The result is signed: callers that
/// need a non-negative duration clamp at the call site (e.g. `.max(0.0)`).
/// Clamping is caller policy, not a property of "diff two timestamps".
pub fn timestamp_diff_ms(a: &str, b: &str) -> f64 {
    let parse = |s: &str| -> f64 {
        chrono::DateTime::parse_from_rfc3339(s)
            .map(|dt| dt.timestamp_millis() as f64)
            .unwrap_or(0.0)
    };
    parse(a) - parse(b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signed_diff_clamp_policy_and_unparseable() {
        assert_eq!(
            timestamp_diff_ms("2024-01-01T00:00:01Z", "2024-01-01T00:00:00Z"),
            1000.0
        );
        // b after a -> negative; the signed primitive does not clamp
        assert_eq!(
            timestamp_diff_ms("2024-01-01T00:00:00Z", "2024-01-01T00:00:01Z"),
            -1000.0
        );
        // an unparseable side contributes 0.0 to its own term, not to the result:
        // "nope" - real ts = -real ts (negative), both unparseable = 0.0
        assert!(timestamp_diff_ms("nope", "2024-01-01T00:00:00Z") < 0.0);
        assert_eq!(timestamp_diff_ms("nope", "also-nope"), 0.0);
    }
}
