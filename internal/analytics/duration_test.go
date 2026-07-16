package analytics

import (
	"math"
	"testing"
)

func TestPercentileMedianAndP95(t *testing.T) {
	data := make([]float64, 100)
	for i := range data {
		data[i] = float64(i + 1)
	}
	// round((100-1) * 0.5) = 50 → data[50] = 51
	got50 := Percentile(data, 0.5)
	if math.Abs(got50-51.0) > 1e-9 {
		t.Errorf("p50: got %v, want 51.0", got50)
	}
	// round((100-1) * 0.95) = round(94.05) = 94 → data[94] = 95
	got95 := Percentile(data, 0.95)
	if math.Abs(got95-95.0) > 1e-9 {
		t.Errorf("p95: got %v, want 95.0", got95)
	}
}

func TestPercentileSingleSample(t *testing.T) {
	if got := Percentile([]float64{42.0}, 0.95); got != 42.0 {
		t.Errorf("single: got %v, want 42.0", got)
	}
	if got := Percentile([]float64{}, 0.5); got != 0.0 {
		t.Errorf("empty: got %v, want 0.0", got)
	}
}

func TestHistogramDistributesValuesAcrossBuckets(t *testing.T) {
	// Bucket width = 10 for 10 buckets over [0, 100].
	// Indices: 0→0 (short-circuit), 10→1, 25→2, 45→4, 60→6, 95→9.
	values := []float64{0.0, 10.0, 25.0, 45.0, 60.0, 95.0}
	buckets := buildHistogram(values, 100.0, 10)

	checks := map[int]uint32{0: 1, 1: 1, 2: 1, 4: 1, 6: 1, 9: 1}
	for idx, want := range checks {
		if buckets[idx] != want {
			t.Errorf("bucket[%d]: got %d, want %d", idx, buckets[idx], want)
		}
	}
	total := uint32(0)
	for _, c := range buckets {
		total += c
	}
	if total != uint32(len(values)) {
		t.Errorf("sum: got %d, want %d", total, len(values))
	}
}

func TestComputeStatsSetsOutlierThresholdFactor(t *testing.T) {
	sorted := make([]float64, 20)
	for i := range sorted {
		sorted[i] = float64(i+1) * 1000.0
	}
	stats := computeDurationStats(sorted)
	// p95 of 1..20: round(19 * 0.95) = round(18.05) = 18 → sorted[18] = 19_000
	if math.Abs(stats.P95Ms-19_000.0) > 1e-9 {
		t.Errorf("p95: got %v, want 19000", stats.P95Ms)
	}
	want := 19_000.0 * OutlierFactor
	if math.Abs(stats.OutlierThresholdMs-want) > 1e-9 {
		t.Errorf("outlier threshold: got %v, want %v", stats.OutlierThresholdMs, want)
	}
}
