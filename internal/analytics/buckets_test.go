// Tests ported from src-tauri/src/analytics/buckets.rs #[cfg(test)] mod tests.
package analytics

import (
	"testing"
	"time"
)

func TestDayKey(t *testing.T) {
	tsMs := 1705320000.0 * 1000.0
	got := BucketKeyFor(GranularityDaily, tsMs)
	if got != "2024-01-15" {
		t.Errorf("got %q, want %q", got, "2024-01-15")
	}
}

func TestHourKey(t *testing.T) {
	tsMs := 1705320000.0 * 1000.0
	got := BucketKeyFor(GranularityHourly, tsMs)
	if got != "2024-01-15-12" {
		t.Errorf("got %q, want %q", got, "2024-01-15-12")
	}
}

func TestHourLabelMidnight(t *testing.T) {
	if got := HourLabel(0); got != "12 AM" {
		t.Errorf("got %q, want %q", got, "12 AM")
	}
}

func TestHourLabelMorning(t *testing.T) {
	if got := HourLabel(9); got != "9 AM" {
		t.Errorf("got %q, want %q", got, "9 AM")
	}
}

func TestHourLabelNoon(t *testing.T) {
	if got := HourLabel(12); got != "12 PM" {
		t.Errorf("got %q, want %q", got, "12 PM")
	}
}

func TestHourLabelAfternoon(t *testing.T) {
	if got := HourLabel(15); got != "3 PM" {
		t.Errorf("got %q, want %q", got, "3 PM")
	}
}

func TestGranularityHourly(t *testing.T) {
	for _, d := range []uint32{1, 2} {
		if got := GranularityForDays(d); got != GranularityHourly {
			t.Errorf("days=%d: got %v, want hourly", d, got)
		}
	}
}

func TestGranularityDaily(t *testing.T) {
	for _, d := range []uint32{3, 14} {
		if got := GranularityForDays(d); got != GranularityDaily {
			t.Errorf("days=%d: got %v, want daily", d, got)
		}
	}
}

func TestGranularityWeekly(t *testing.T) {
	for _, d := range []uint32{15, 56} {
		if got := GranularityForDays(d); got != GranularityWeekly {
			t.Errorf("days=%d: got %v, want weekly", d, got)
		}
	}
}

func TestGranularityMonthly(t *testing.T) {
	for _, d := range []uint32{57, 90} {
		if got := GranularityForDays(d); got != GranularityMonthly {
			t.Errorf("days=%d: got %v, want monthly", d, got)
		}
	}
}

func TestMonthKey(t *testing.T) {
	tsMs := 1705320000.0 * 1000.0
	got := BucketKeyFor(GranularityMonthly, tsMs)
	if got != "2024-01" {
		t.Errorf("got %q, want %q", got, "2024-01")
	}
}

func TestMonthLabel(t *testing.T) {
	cases := []struct {
		year  int
		month time.Month
		want  string
	}{
		{2024, time.January, "Jan 2024"},
		{2024, time.December, "Dec 2024"},
	}
	for _, c := range cases {
		got := MonthLabel(c.year, c.month)
		if got != c.want {
			t.Errorf("MonthLabel(%d,%v): got %q, want %q", c.year, c.month, got, c.want)
		}
	}
}

func TestMakeEmptyBucket(t *testing.T) {
	b := MakeEmptyBucket("key", "label")
	if b.Key != "key" {
		t.Errorf("Key: got %q", b.Key)
	}
	if b.TotalTokens != 0 {
		t.Errorf("TotalTokens: got %d", b.TotalTokens)
	}
	if b.SessionCount != 0 {
		t.Errorf("SessionCount: got %d", b.SessionCount)
	}
}
