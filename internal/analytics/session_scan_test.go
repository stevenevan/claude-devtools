// Tests ported from src-tauri/src/analytics/session_scan.rs #[cfg(test)] mod tests.
package analytics

import (
	"math"
	"testing"
)

func TestActiveMsEmptyAndSingle(t *testing.T) {
	if got := ActiveMsFromSorted([]float64{}); got != 0.0 {
		t.Errorf("empty: got %v", got)
	}
	if got := ActiveMsFromSorted([]float64{100.0}); got != 0.0 {
		t.Errorf("single: got %v", got)
	}
}

func TestActiveMsSumUncapped(t *testing.T) {
	// Gaps 1000, 2000 → 3000ms active.
	stamps := []float64{0.0, 1000.0, 3000.0}
	got := ActiveMsFromSorted(stamps)
	if got != 3000.0 {
		t.Errorf("got %v, want 3000.0", got)
	}
}

func TestActiveMsCapsLongIdleGap(t *testing.T) {
	// Gap 1hr is capped at ActiveGapCapMs (5min), small gap counts fully.
	stamps := []float64{0.0, 1000.0, 1000.0 + 3600_000.0}
	got := ActiveMsFromSorted(stamps)
	want := 1000.0 + ActiveGapCapMs
	if math.Abs(got-want) > 1e-9 {
		t.Errorf("got %v, want %v", got, want)
	}
}
