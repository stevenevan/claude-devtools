import type {
  AnalyticsResponse,
  CostForecast,
  ModelComparisonResponse,
  ProductivityMetrics,
  SessionDurationResponse,
} from '@shared/types';

import { call } from '../invoke';

// Flat analytics data methods (DesktopAPI top-level, W8). Each mirrors
// analyticsservice.Get* → analytics.Compute*. No reviveDates: the legacy adapter
// (domain/analytics.ts) revives none of these, so the Tauri path must not either.
// countTokens/countTokensBatch are intentionally absent — they have no DesktopAPI
// slot (the frontend estimates tokens itself); tokenizer.rs is module-parity only.
export const analyticsCommands = {
  getAnalytics: (days: number): Promise<AnalyticsResponse> =>
    call<AnalyticsResponse>('get_analytics', { days }),
  getCostForecast: (windowDays: number): Promise<CostForecast> =>
    call<CostForecast>('get_cost_forecast', { windowDays }),
  getProductivityMetrics: (days: number): Promise<ProductivityMetrics> =>
    call<ProductivityMetrics>('get_productivity_metrics', { days }),
  getSessionDurationStats: (days: number): Promise<SessionDurationResponse> =>
    call<SessionDurationResponse>('get_session_duration_stats', { days }),
  getModelComparison: (days: number): Promise<ModelComparisonResponse> =>
    call<ModelComparisonResponse>('get_model_comparison', { days }),
};
