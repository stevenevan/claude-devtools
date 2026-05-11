import { invoke } from '@tauri-apps/api/core';

import type {
  AggregatedSessionTodos,
  AnalyticsResponse,
  BackendCacheStats,
  BackendTimingSummary,
  CostForecast,
  ElectronAPI,
  ErrorClustersResponse,
  ErrorHotspotsResponse,
  FileGraphResponse,
  ModelComparisonResponse,
  ParsedNLQuery,
  ProductivityMetrics,
  SessionDurationResponse,
  ToolAnalyticsResponse,
  ToolTimeHeatmapResponse,
} from '@shared/types';

type AnalyticsSlice = Pick<
  ElectronAPI,
  | 'getAnalytics'
  | 'getCostForecast'
  | 'getProductivityMetrics'
  | 'getSessionDurationStats'
  | 'getModelComparison'
  | 'getFileGraph'
  | 'getToolAnalytics'
  | 'getToolTimeHeatmap'
  | 'getErrorHotspots'
  | 'getErrorClusters'
  | 'getAllTodos'
  | 'parseNLQuery'
  | 'getBackendTimings'
  | 'getCacheStats'
  | 'setCacheCapacity'
  | 'clearSessionCache'
>;

export const analyticsApi: AnalyticsSlice = {
  getAnalytics: (days: number): Promise<AnalyticsResponse> =>
    invoke<AnalyticsResponse>('get_analytics', { days }),

  getCostForecast: (windowDays: number): Promise<CostForecast> =>
    invoke<CostForecast>('get_cost_forecast', { windowDays }),

  getProductivityMetrics: (days: number): Promise<ProductivityMetrics> =>
    invoke<ProductivityMetrics>('get_productivity_metrics', { days }),

  getSessionDurationStats: (days: number): Promise<SessionDurationResponse> =>
    invoke<SessionDurationResponse>('get_session_duration_stats', { days }),

  getModelComparison: (days: number): Promise<ModelComparisonResponse> =>
    invoke<ModelComparisonResponse>('get_model_comparison', { days }),

  getFileGraph: (projectId: string, sessionId: string): Promise<FileGraphResponse> =>
    invoke<FileGraphResponse>('get_file_graph', { projectId, sessionId }),

  getToolAnalytics: (projectId: string, days: number): Promise<ToolAnalyticsResponse> =>
    invoke<ToolAnalyticsResponse>('get_tool_analytics', { projectId, days }),

  getToolTimeHeatmap: (
    projectId: string,
    days: number,
    toolFilter?: string | null
  ): Promise<ToolTimeHeatmapResponse> =>
    invoke<ToolTimeHeatmapResponse>('get_tool_time_heatmap', {
      projectId,
      days,
      toolFilter: toolFilter ?? null,
    }),

  getErrorHotspots: (
    projectId: string,
    days: number,
    minOccurrences: number
  ): Promise<ErrorHotspotsResponse> =>
    invoke<ErrorHotspotsResponse>('get_error_hotspots', {
      projectId,
      days,
      minOccurrences,
    }),

  getErrorClusters: (
    projectId: string,
    days: number,
    minClusterSize: number
  ): Promise<ErrorClustersResponse> =>
    invoke<ErrorClustersResponse>('get_error_clusters', {
      projectId,
      days,
      minClusterSize,
    }),

  getAllTodos: (projectIds: string[]): Promise<AggregatedSessionTodos[]> =>
    invoke<AggregatedSessionTodos[]>('get_all_todos', { projectIds }),

  parseNLQuery: (query: string): Promise<ParsedNLQuery> =>
    invoke<ParsedNLQuery>('parse_nl_query', { query }),

  getBackendTimings: (limit?: number): Promise<BackendTimingSummary[]> =>
    invoke<BackendTimingSummary[]>('get_backend_timings', { limit: limit ?? null }),

  getCacheStats: (): Promise<BackendCacheStats> => invoke<BackendCacheStats>('get_cache_stats'),

  setCacheCapacity: (capacity: number): Promise<void> =>
    invoke<void>('set_cache_capacity', { capacity }),

  clearSessionCache: (): Promise<void> => invoke<void>('clear_session_cache'),
};
