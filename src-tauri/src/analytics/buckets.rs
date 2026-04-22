// Time bucket helpers — granularity derivation and key/label formatting.

use chrono::{Datelike, NaiveDate, Timelike};
use serde::{Deserialize, Serialize};

use super::types::TimeBucketUsage;

/// Bucket granularity derived from the requested day count.
///   1 day          → Hourly  (24 buckets)
///   2–14 days      → Daily
///   15–56 days     → Weekly  (Mon-based weeks)
///   57–90 days     → Monthly
///   >90            → rejected by the frontend
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BucketGranularity {
    Hourly,
    Daily,
    Weekly,
    Monthly,
}

pub fn granularity_for_days(days: u32) -> BucketGranularity {
    match days {
        0..=2 => BucketGranularity::Hourly,
        3..=14 => BucketGranularity::Daily,
        15..=56 => BucketGranularity::Weekly,
        _ => BucketGranularity::Monthly,
    }
}

pub fn day_key(ts_ms: f64) -> String {
    let secs = (ts_ms / 1000.0) as i64;
    let dt = chrono::DateTime::from_timestamp(secs, 0).unwrap_or_default();
    format!("{:04}-{:02}-{:02}", dt.year(), dt.month(), dt.day())
}

pub fn hour_key(ts_ms: f64) -> String {
    let secs = (ts_ms / 1000.0) as i64;
    let dt = chrono::DateTime::from_timestamp(secs, 0).unwrap_or_default();
    format!(
        "{:04}-{:02}-{:02}-{:02}",
        dt.year(),
        dt.month(),
        dt.day(),
        dt.hour()
    )
}

pub fn day_label(date: &NaiveDate) -> String {
    date.format("%b %-d").to_string()
}

pub fn hour_label(h: u32) -> String {
    match h {
        0 => "12 AM".into(),
        h if h < 12 => format!("{h} AM"),
        12 => "12 PM".into(),
        h => format!("{} PM", h - 12),
    }
}

pub fn week_key(ts_ms: f64) -> String {
    let secs = (ts_ms / 1000.0) as i64;
    let dt = chrono::DateTime::from_timestamp(secs, 0).unwrap_or_default();
    let naive = dt.date_naive();
    let monday = naive - chrono::Duration::days(naive.weekday().num_days_from_monday() as i64);
    format!("{:04}-W{:02}", monday.year(), monday.iso_week().week())
}

pub fn week_label(monday: &NaiveDate) -> String {
    let sunday = *monday + chrono::Duration::days(6);
    if monday.month() == sunday.month() {
        format!("{} {}-{}", monday.format("%b"), monday.day(), sunday.day())
    } else {
        format!("{} - {}", monday.format("%b %-d"), sunday.format("%b %-d"))
    }
}

pub fn month_key(ts_ms: f64) -> String {
    let secs = (ts_ms / 1000.0) as i64;
    let dt = chrono::DateTime::from_timestamp(secs, 0).unwrap_or_default();
    format!("{:04}-{:02}", dt.year(), dt.month())
}

pub fn month_label(year: i32, month: u32) -> String {
    let d = NaiveDate::from_ymd_opt(year, month, 1).unwrap_or_default();
    d.format("%b %Y").to_string()
}

pub fn make_empty_bucket(key: String, label: String) -> TimeBucketUsage {
    TimeBucketUsage {
        key,
        label,
        total_tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cost_usd: 0.0,
        session_count: 0,
    }
}

pub fn bucket_key_for(granularity: BucketGranularity, ts_ms: f64) -> String {
    match granularity {
        BucketGranularity::Hourly => hour_key(ts_ms),
        BucketGranularity::Daily => day_key(ts_ms),
        BucketGranularity::Weekly => week_key(ts_ms),
        BucketGranularity::Monthly => month_key(ts_ms),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_day_key() {
        let ts_ms = 1705320000.0 * 1000.0;
        assert_eq!(day_key(ts_ms), "2024-01-15");
    }

    #[test]
    fn test_hour_key() {
        let ts_ms = 1705320000.0 * 1000.0;
        assert_eq!(hour_key(ts_ms), "2024-01-15-12");
    }

    #[test]
    fn test_hour_label_midnight() {
        assert_eq!(hour_label(0), "12 AM");
    }

    #[test]
    fn test_hour_label_morning() {
        assert_eq!(hour_label(9), "9 AM");
    }

    #[test]
    fn test_hour_label_noon() {
        assert_eq!(hour_label(12), "12 PM");
    }

    #[test]
    fn test_hour_label_afternoon() {
        assert_eq!(hour_label(15), "3 PM");
    }

    #[test]
    fn test_granularity_hourly() {
        assert!(matches!(granularity_for_days(1), BucketGranularity::Hourly));
        assert!(matches!(granularity_for_days(2), BucketGranularity::Hourly));
    }

    #[test]
    fn test_granularity_daily() {
        assert!(matches!(granularity_for_days(3), BucketGranularity::Daily));
        assert!(matches!(granularity_for_days(14), BucketGranularity::Daily));
    }

    #[test]
    fn test_granularity_weekly() {
        assert!(matches!(granularity_for_days(15), BucketGranularity::Weekly));
        assert!(matches!(granularity_for_days(56), BucketGranularity::Weekly));
    }

    #[test]
    fn test_granularity_monthly() {
        assert!(matches!(granularity_for_days(57), BucketGranularity::Monthly));
        assert!(matches!(granularity_for_days(90), BucketGranularity::Monthly));
    }

    #[test]
    fn test_month_key() {
        let ts_ms = 1705320000.0 * 1000.0;
        assert_eq!(month_key(ts_ms), "2024-01");
    }

    #[test]
    fn test_month_label() {
        assert_eq!(month_label(2024, 1), "Jan 2024");
        assert_eq!(month_label(2024, 12), "Dec 2024");
    }

    #[test]
    fn test_make_empty_bucket() {
        let b = make_empty_bucket("key".to_string(), "label".to_string());
        assert_eq!(b.key, "key");
        assert_eq!(b.total_tokens, 0);
        assert_eq!(b.session_count, 0);
    }
}
