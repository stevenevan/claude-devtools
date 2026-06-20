// Tests port timing.rs #[test]s verbatim.
package timingservice

import (
	"testing"
	"time"
)

// ring_buffer_overwrites_at_capacity
func TestRingBufferOverwritesAtCapacity(t *testing.T) {
	buf := NewTimingBuffer(3)
	buf.Record("a", 1.0)
	buf.Record("b", 2.0)
	buf.Record("c", 3.0)
	buf.Record("d", 4.0) // pushes "a" out

	snap := buf.Snapshot()
	if len(snap) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(snap))
	}
	// snapshot is newest-first: d, c, b
	cmds := []string{snap[0].Command, snap[1].Command, snap[2].Command}
	want := []string{"d", "c", "b"}
	for i, got := range cmds {
		if got != want[i] {
			t.Errorf("pos %d: got %q, want %q", i, got, want[i])
		}
	}
}

// percentile_summary_basic
func TestPercentileSummaryBasic(t *testing.T) {
	entries := []TimingEntry{
		{Command: "x", DurationMs: 10.0},
		{Command: "x", DurationMs: 20.0},
		{Command: "x", DurationMs: 30.0},
		{Command: "x", DurationMs: 40.0},
		{Command: "x", DurationMs: 50.0},
	}
	summary := Summarize(entries)
	if len(summary) != 1 {
		t.Fatalf("expected 1, got %d", len(summary))
	}
	s := summary[0]
	if s.Count != 5 {
		t.Errorf("Count: %d", s.Count)
	}
	if s.MaxMs != 50.0 {
		t.Errorf("MaxMs: %v", s.MaxMs)
	}
	if s.P50Ms != 30.0 {
		t.Errorf("P50Ms: %v", s.P50Ms)
	}
}

// timing_guard_records_on_drop — adapted for Go (no RAII; use explicit timing)
func TestTimingBufferRecordThenSnapshot(t *testing.T) {
	buf := NewTimingBuffer(10)

	start := time.Now()
	time.Sleep(2 * time.Millisecond)
	elapsed := float64(time.Since(start).Milliseconds())
	buf.Record("fast", elapsed)

	snap := buf.Snapshot()
	if len(snap) != 1 {
		t.Fatalf("expected 1, got %d", len(snap))
	}
	if snap[0].Command != "fast" {
		t.Errorf("command: %q", snap[0].Command)
	}
	if snap[0].DurationMs < 1.0 {
		t.Errorf("duration too small: %v", snap[0].DurationMs)
	}
}
