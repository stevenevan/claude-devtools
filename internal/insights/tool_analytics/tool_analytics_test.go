package tool_analytics

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// writeFixture writes JSONL lines to a temp directory and returns the file path.
func writeFixture(t *testing.T, name string, lines []string) string {
	t.Helper()
	dir := filepath.Join(os.TempDir(), fmt.Sprintf("ta_test_%s_%d", name, os.Getpid()))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })

	path := filepath.Join(dir, "session.jsonl")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	for _, l := range lines {
		fmt.Fprintln(f, l)
	}
	return path
}

func TestMedianOddEven(t *testing.T) {
	a := []uint64{1, 5, 9}
	if got := medianU64(a); got != 5 {
		t.Errorf("odd median: got %d want 5", got)
	}
	b := []uint64{1, 5, 9, 11}
	if got := medianU64(b); got != 7 {
		t.Errorf("even median: got %d want 7", got)
	}
	var c []uint64
	if got := medianU64(c); got != 0 {
		t.Errorf("empty median: got %d want 0", got)
	}
}

func TestScanPairsToolUseAndResult(t *testing.T) {
	lines := []string{
		`{"timestamp":"2026-04-16T10:00:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}]}}`,
		`{"timestamp":"2026-04-16T10:00:02.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok","is_error":false}]}}`,
		`{"timestamp":"2026-04-16T10:00:05.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t2","name":"Bash","input":{"command":"cat x"}}]}}`,
		`{"timestamp":"2026-04-16T10:00:06.500Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t2","content":"fail","is_error":true}]}}`,
		`{"timestamp":"2026-04-16T10:00:10.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t3","name":"Read","input":{"path":"/a"}}]}}`,
		`{"timestamp":"2026-04-16T10:00:11.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t3","content":"abcdefg","is_error":false}]}}`,
	}
	path := writeFixture(t, "pairs", lines)

	stats := make(map[string]*toolStats)
	scanSession(path, stats)
	results := finalize(stats)

	var bash, read *ToolUsageSummary
	for i := range results {
		switch results[i].ToolName {
		case "Bash":
			bash = &results[i]
		case "Read":
			read = &results[i]
		}
	}
	if bash == nil {
		t.Fatal("Bash stats missing")
	}
	if bash.CallCount != 2 {
		t.Errorf("Bash.CallCount: got %d want 2", bash.CallCount)
	}
	if bash.SuccessCount != 1 {
		t.Errorf("Bash.SuccessCount: got %d want 1", bash.SuccessCount)
	}
	if bash.ErrorCount != 1 {
		t.Errorf("Bash.ErrorCount: got %d want 1", bash.ErrorCount)
	}
	if diff := bash.SuccessRate - 0.5; diff > 1e-9 || diff < -1e-9 {
		t.Errorf("Bash.SuccessRate: got %f want 0.5", bash.SuccessRate)
	}
	if diff := bash.ErrorRate - 0.5; diff > 1e-9 || diff < -1e-9 {
		t.Errorf("Bash.ErrorRate: got %f want 0.5", bash.ErrorRate)
	}
	// Durations: 2000ms and 1500ms → avg 1750ms
	if diff := bash.AvgDurationMs - 1750.0; diff > 1e-6 || diff < -1e-6 {
		t.Errorf("Bash.AvgDurationMs: got %f want 1750.0", bash.AvgDurationMs)
	}

	if read == nil {
		t.Fatal("Read stats missing")
	}
	if read.CallCount != 1 {
		t.Errorf("Read.CallCount: got %d want 1", read.CallCount)
	}
	if read.SuccessCount != 1 {
		t.Errorf("Read.SuccessCount: got %d want 1", read.SuccessCount)
	}
	if read.ErrorCount != 0 {
		t.Errorf("Read.ErrorCount: got %d want 0", read.ErrorCount)
	}
	if read.MedianTokenCost == 0 {
		t.Error("Read.MedianTokenCost: expected > 0")
	}
}

func TestFinalizeSortsByCallCountDesc(t *testing.T) {
	stats := map[string]*toolStats{
		"A": {callCount: 1, successCount: 1},
		"B": {callCount: 5, successCount: 5},
		"C": {callCount: 3, successCount: 2, errorCount: 1},
	}
	out := finalize(stats)
	if len(out) != 3 {
		t.Fatalf("got %d entries want 3", len(out))
	}
	if out[0].ToolName != "B" || out[1].ToolName != "C" || out[2].ToolName != "A" {
		t.Errorf("wrong order: %s %s %s", out[0].ToolName, out[1].ToolName, out[2].ToolName)
	}
}

func TestOrphanToolResultIgnored(t *testing.T) {
	lines := []string{
		`{"timestamp":"2026-04-16T10:00:00.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"missing","content":"x","is_error":false}]}}`,
	}
	path := writeFixture(t, "orphan", lines)

	stats := make(map[string]*toolStats)
	scanSession(path, stats)
	if len(stats) != 0 {
		t.Errorf("expected empty stats, got %d entries", len(stats))
	}
}

func TestHeatmapBucketLocalRange(t *testing.T) {
	// 2026-04-20 (Monday) at 15:30 UTC
	ms := float64(1745162200000) // computed from rfc3339 "2026-04-20T15:30:00Z"
	day, hour, ok := bucketLocal(ms)
	if !ok {
		t.Fatal("bucketLocal returned ok=false")
	}
	if day >= 7 {
		t.Errorf("day %d out of range [0,6]", day)
	}
	if hour >= 24 {
		t.Errorf("hour %d out of range [0,23]", hour)
	}
}

func TestHeatmapScanBucketsAssistantToolUses(t *testing.T) {
	lines := []string{
		`{"timestamp":"2026-04-20T09:00:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{}}]}}`,
		`{"timestamp":"2026-04-20T09:00:10.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t2","name":"Bash","input":{}}]}}`,
		`{"timestamp":"2026-04-20T09:00:20.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t3","name":"Read","input":{}}]}}`,
	}
	path := writeFixture(t, "heatmap", lines)

	buckets := make(map[heatmapKey]*heatmapCellAcc)
	scanSessionHeatmap(path, buckets, "")

	if len(buckets) != 1 {
		t.Fatalf("expected 1 bucket, got %d", len(buckets))
	}
	var cell *heatmapCellAcc
	for _, c := range buckets {
		cell = c
	}
	if cell.total != 3 {
		t.Errorf("total: got %d want 3", cell.total)
	}
	if cell.perTool["Bash"] != 2 {
		t.Errorf("Bash count: got %d want 2", cell.perTool["Bash"])
	}
	if cell.perTool["Read"] != 1 {
		t.Errorf("Read count: got %d want 1", cell.perTool["Read"])
	}
}

func TestHeatmapToolFilterExcludesNonMatching(t *testing.T) {
	lines := []string{
		`{"timestamp":"2026-04-20T09:00:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{}}]}}`,
		`{"timestamp":"2026-04-20T09:00:10.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t2","name":"Read","input":{}}]}}`,
	}
	path := writeFixture(t, "heatmap_filter", lines)

	buckets := make(map[heatmapKey]*heatmapCellAcc)
	scanSessionHeatmap(path, buckets, "Bash")

	if len(buckets) != 1 {
		t.Fatalf("expected 1 bucket, got %d", len(buckets))
	}
	var cell *heatmapCellAcc
	for _, c := range buckets {
		cell = c
	}
	if cell.total != 1 {
		t.Errorf("total: got %d want 1", cell.total)
	}
	if _, ok := cell.perTool["Bash"]; !ok {
		t.Error("Bash not in perTool")
	}
	if _, ok := cell.perTool["Read"]; ok {
		t.Error("Read should not be in perTool after filter")
	}
}
