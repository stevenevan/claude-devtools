// Bucket granularity helpers — mirrors src-tauri/src/analytics/buckets.rs.
package analytics

import (
	"fmt"
	"time"
)

// BucketGranularity mirrors buckets::BucketGranularity.
// JSON values must match the serde camelCase enum variants the frontend expects.
type BucketGranularity string

const (
	GranularityHourly  BucketGranularity = "hourly"
	GranularityDaily   BucketGranularity = "daily"
	GranularityWeekly  BucketGranularity = "weekly"
	GranularityMonthly BucketGranularity = "monthly"
)

// GranularityForDays derives the bucket granularity from the day count.
// Mirrors buckets::granularity_for_days.
func GranularityForDays(days uint32) BucketGranularity {
	switch {
	case days <= 2:
		return GranularityHourly
	case days <= 14:
		return GranularityDaily
	case days <= 56:
		return GranularityWeekly
	default:
		return GranularityMonthly
	}
}

// BucketKeyFor returns the bucket key string for a timestamp (ms) given granularity.
// Mirrors buckets::bucket_key_for.
func BucketKeyFor(g BucketGranularity, tsMs float64) string {
	t := msToTime(tsMs)
	switch g {
	case GranularityHourly:
		return hourKey(t)
	case GranularityDaily:
		return dayKey(t)
	case GranularityWeekly:
		return weekKey(t)
	default:
		return monthKey(t)
	}
}

func msToTime(ms float64) time.Time {
	secs := int64(ms / 1000.0)
	nsec := int64((ms/1000.0-float64(secs))*1e9)
	return time.Unix(secs, nsec).UTC()
}

func dayKey(t time.Time) string {
	return fmt.Sprintf("%04d-%02d-%02d", t.Year(), t.Month(), t.Day())
}

func hourKey(t time.Time) string {
	return fmt.Sprintf("%04d-%02d-%02d-%02d", t.Year(), t.Month(), t.Day(), t.Hour())
}

func weekKey(t time.Time) string {
	// ISO week Mon-based, matching Rust chrono.
	monday := isoMonday(t)
	y, w := monday.ISOWeek()
	return fmt.Sprintf("%04d-W%02d", y, w)
}

func monthKey(t time.Time) string {
	return fmt.Sprintf("%04d-%02d", t.Year(), t.Month())
}

// DayLabel formats a date as "Jan 2" (%-d in Rust). Mirrors buckets::day_label.
func DayLabel(t time.Time) string {
	return fmt.Sprintf("%s %d", t.Format("Jan"), t.Day())
}

// HourLabel formats a 0-23 hour as "12 AM", "9 AM", "12 PM", "3 PM".
// Mirrors buckets::hour_label.
func HourLabel(h int) string {
	switch {
	case h == 0:
		return "12 AM"
	case h < 12:
		return fmt.Sprintf("%d AM", h)
	case h == 12:
		return "12 PM"
	default:
		return fmt.Sprintf("%d PM", h-12)
	}
}

// WeekLabel formats a Monday date as "Jan 2-8" or "Jan 31 - Feb 6".
// Mirrors buckets::week_label.
func WeekLabel(monday time.Time) string {
	sunday := monday.AddDate(0, 0, 6)
	if monday.Month() == sunday.Month() {
		return fmt.Sprintf("%s %d-%d", monday.Format("Jan"), monday.Day(), sunday.Day())
	}
	return fmt.Sprintf("%s %d - %s %d",
		monday.Format("Jan"), monday.Day(),
		sunday.Format("Jan"), sunday.Day())
}

// MonthLabel formats year+month as "Jan 2024". Mirrors buckets::month_label.
func MonthLabel(year int, month time.Month) string {
	return fmt.Sprintf("%s %d", month.String()[:3], year)
}

// MakeEmptyBucket returns a zero-valued TimeBucketUsage. Mirrors buckets::make_empty_bucket.
func MakeEmptyBucket(key, label string) TimeBucketUsage {
	return TimeBucketUsage{
		Key:             key,
		Label:           label,
		TotalTokens:     0,
		InputTokens:     0,
		OutputTokens:    0,
		CacheReadTokens: 0,
		CostUSD:         0.0,
		SessionCount:    0,
	}
}

// isoMonday returns the Monday of the ISO week containing t.
func isoMonday(t time.Time) time.Time {
	// time.Weekday: 0=Sun, 1=Mon..6=Sat; ISO Mon=0..Sun=6
	wd := int(t.Weekday())
	if wd == 0 {
		wd = 7
	}
	return t.AddDate(0, 0, -(wd - 1)).Truncate(24 * time.Hour)
}
