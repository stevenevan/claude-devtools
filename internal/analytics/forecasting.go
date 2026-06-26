// Cost forecasting — mirrors src-tauri/src/analytics/forecasting.rs.
// Linear regression over trailing N session-day cost totals.
package analytics

// CostForecast is the payload returned by GetCostForecast.
type CostForecast struct {
	ProjectedDailyCostUSD  float64   `json:"projectedDailyCostUsd"`
	ProjectedWeeklyCostUSD float64   `json:"projectedWeeklyCostUsd"`
	TrendSlopeUSDPerDay    float64   `json:"trendSlopeUsdPerDay"`
	SampleDays             uint32    `json:"sampleDays"`
	RecentDailyCosts       []float64 `json:"recentDailyCosts"`
}

// LinearFit fits y = slope*x + intercept over costs (x = index position).
// Returns (slope, intercept). Fewer than 2 points → slope 0, intercept = mean.
// Mirrors forecasting::linear_fit.
func LinearFit(costs []float64) (slope, intercept float64) {
	n := len(costs)
	if n == 0 {
		return 0.0, 0.0
	}
	if n == 1 {
		return 0.0, costs[0]
	}

	nf := float64(n)
	sumX := nf * (nf - 1.0) / 2.0 // 0+1+...+(n-1)
	sumY := 0.0
	for _, c := range costs {
		sumY += c
	}
	sumXY := 0.0
	for i, c := range costs {
		sumXY += float64(i) * c
	}
	sumXX := 0.0
	for i := 0; i < n; i++ {
		sumXX += float64(i) * float64(i)
	}

	denom := nf*sumXX - sumX*sumX
	if denom < 1e-300 && denom > -1e-300 { // abs < epsilon
		return 0.0, sumY / nf
	}

	slope = (nf*sumXY - sumX*sumY) / denom
	intercept = (sumY - slope*sumX) / nf
	return
}

// ForecastFromDailyCosts runs linear regression and projects the next day's cost.
// Mirrors forecasting::forecast_from_daily_costs.
func ForecastFromDailyCosts(costs []float64) CostForecast {
	sampleDays := uint32(len(costs))
	slope, intercept := LinearFit(costs)

	projectedDaily := 0.0
	if len(costs) > 0 {
		projectedDaily = slope*float64(len(costs)) + intercept
	}
	if projectedDaily < 0.0 {
		projectedDaily = 0.0
	}

	recentCosts := make([]float64, len(costs))
	copy(recentCosts, costs)

	return CostForecast{
		ProjectedDailyCostUSD:  projectedDaily,
		ProjectedWeeklyCostUSD: projectedDaily * 7.0,
		TrendSlopeUSDPerDay:    slope,
		SampleDays:             sampleDays,
		RecentDailyCosts:       recentCosts,
	}
}

// ComputeCostForecast pulls trailing daily cost totals from analytics and runs
// linear regression. Mirrors forecasting::compute_cost_forecast.
func ComputeCostForecast(windowDays uint32) (*CostForecast, error) {
	days := windowDays
	if days < 2 {
		days = 2
	}
	if days > 90 {
		days = 90
	}

	response, err := ComputeAnalytics(days)
	if err != nil {
		return nil, err
	}

	var costs []float64
	if response.Granularity == GranularityDaily {
		costs = make([]float64, len(response.TimeBuckets))
		for i, b := range response.TimeBuckets {
			costs[i] = b.CostUSD
		}
	} else {
		// Fallback: uniform per-day average — no trend signal.
		avg := response.TotalCost / float64(days)
		costs = make([]float64, days)
		for i := range costs {
			costs[i] = avg
		}
	}

	f := ForecastFromDailyCosts(costs)
	return &f, nil
}
