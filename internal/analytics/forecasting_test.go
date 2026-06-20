// Tests ported from src-tauri/src/analytics/forecasting.rs #[cfg(test)] mod tests.
package analytics

import (
	"math"
	"testing"
)

func TestLinearFitEmpty(t *testing.T) {
	s, i := LinearFit([]float64{})
	if s != 0.0 || i != 0.0 {
		t.Errorf("got (%v, %v), want (0, 0)", s, i)
	}
}

func TestLinearFitSingle(t *testing.T) {
	s, i := LinearFit([]float64{42.0})
	if s != 0.0 || i != 42.0 {
		t.Errorf("got (%v, %v), want (0, 42)", s, i)
	}
}

func TestLinearFitTrend(t *testing.T) {
	s, _ := LinearFit([]float64{10.0, 12.0, 14.0, 16.0})
	if math.Abs(s-2.0) > 1e-9 {
		t.Errorf("slope: got %v, want 2.0", s)
	}
}

func TestForecastMatchesPlanExample(t *testing.T) {
	// Plan fixture: [10, 12, 14, 16] → slope ≈ 2, projected daily ≈ 18.
	f := ForecastFromDailyCosts([]float64{10.0, 12.0, 14.0, 16.0})
	if math.Abs(f.TrendSlopeUSDPerDay-2.0) > 1e-9 {
		t.Errorf("slope: got %v, want 2.0", f.TrendSlopeUSDPerDay)
	}
	if math.Abs(f.ProjectedDailyCostUSD-18.0) > 1e-9 {
		t.Errorf("daily: got %v, want 18.0", f.ProjectedDailyCostUSD)
	}
	if math.Abs(f.ProjectedWeeklyCostUSD-126.0) > 1e-9 {
		t.Errorf("weekly: got %v, want 126.0", f.ProjectedWeeklyCostUSD)
	}
	if f.SampleDays != 4 {
		t.Errorf("sampleDays: got %d, want 4", f.SampleDays)
	}
}

func TestForecastProjectionFlooredAtZero(t *testing.T) {
	// Steep negative slope — projection must be clamped at 0.
	f := ForecastFromDailyCosts([]float64{10.0, 5.0, 1.0, 0.0})
	if f.ProjectedDailyCostUSD < 0.0 {
		t.Errorf("got negative: %v", f.ProjectedDailyCostUSD)
	}
}

func TestForecastEmpty(t *testing.T) {
	f := ForecastFromDailyCosts([]float64{})
	if f.ProjectedDailyCostUSD != 0.0 {
		t.Errorf("daily: got %v", f.ProjectedDailyCostUSD)
	}
	if f.ProjectedWeeklyCostUSD != 0.0 {
		t.Errorf("weekly: got %v", f.ProjectedWeeklyCostUSD)
	}
	if f.SampleDays != 0 {
		t.Errorf("sampleDays: got %d", f.SampleDays)
	}
}
