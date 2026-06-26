import {
  GetAnalytics,
  GetCostForecast,
  GetErrorClusters,
  GetErrorHotspots,
  GetFileGraph,
  GetModelComparison,
  GetProductivityMetrics,
  GetSessionDurationStats,
  GetToolAnalytics,
  GetToolTimeHeatmap,
} from '../../../../bindings/claude-devtools/internal/analyticsservice/analyticsservice';
import { ParseNlQuery } from '../../../../bindings/claude-devtools/internal/searchservice/searchservice';
import { GetAllTodos } from '../../../../bindings/claude-devtools/internal/systemservice/systemservice';
import {
  ClearSessionCache,
  GetBackendTimings,
  GetCacheStats,
  SetCacheCapacity,
} from '../../../../bindings/claude-devtools/internal/timingservice/timingservice';

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
    GetAnalytics(days) as unknown as Promise<AnalyticsResponse>,

  getCostForecast: (windowDays: number): Promise<CostForecast> =>
    GetCostForecast(windowDays) as unknown as Promise<CostForecast>,

  getProductivityMetrics: (days: number): Promise<ProductivityMetrics> =>
    GetProductivityMetrics(days) as unknown as Promise<ProductivityMetrics>,

  getSessionDurationStats: (days: number): Promise<SessionDurationResponse> =>
    GetSessionDurationStats(days) as unknown as Promise<SessionDurationResponse>,

  getModelComparison: (days: number): Promise<ModelComparisonResponse> =>
    GetModelComparison(days) as unknown as Promise<ModelComparisonResponse>,

  // NOTE: GetFileGraph binding added canonicalRoot as first arg (new in Go port).
  // Frontend does not know this path; passing "" lets the backend resolve it.
  getFileGraph: (projectId: string, sessionId: string): Promise<FileGraphResponse> =>
    GetFileGraph('', projectId, sessionId) as unknown as Promise<FileGraphResponse>,

  getToolAnalytics: (projectId: string, days: number): Promise<ToolAnalyticsResponse> =>
    GetToolAnalytics(projectId, days) as unknown as Promise<ToolAnalyticsResponse>,

  // NOTE: binding takes toolFilter: string (not nullable); "" means no filter.
  getToolTimeHeatmap: (
    projectId: string,
    days: number,
    toolFilter?: string | null
  ): Promise<ToolTimeHeatmapResponse> =>
    GetToolTimeHeatmap(
      projectId,
      days,
      toolFilter ?? ''
    ) as unknown as Promise<ToolTimeHeatmapResponse>,

  getErrorHotspots: (
    projectId: string,
    days: number,
    minOccurrences: number
  ): Promise<ErrorHotspotsResponse> =>
    GetErrorHotspots(projectId, days, minOccurrences) as unknown as Promise<ErrorHotspotsResponse>,

  getErrorClusters: (
    projectId: string,
    days: number,
    minClusterSize: number
  ): Promise<ErrorClustersResponse> =>
    GetErrorClusters(
      projectId,
      days,
      minClusterSize
    ) as unknown as Promise<ErrorClustersResponse>,

  getAllTodos: (projectIds: string[]): Promise<AggregatedSessionTodos[]> =>
    GetAllTodos(projectIds) as unknown as Promise<AggregatedSessionTodos[]>,

  parseNLQuery: (query: string): Promise<ParsedNLQuery> =>
    ParseNlQuery(query) as unknown as Promise<ParsedNLQuery>,

  getBackendTimings: (limit?: number): Promise<BackendTimingSummary[]> =>
    GetBackendTimings(limit ?? null) as unknown as Promise<BackendTimingSummary[]>,

  getCacheStats: (): Promise<BackendCacheStats> =>
    GetCacheStats() as unknown as Promise<BackendCacheStats>,

  setCacheCapacity: (capacity: number): Promise<void> => SetCacheCapacity(capacity),

  clearSessionCache: (): Promise<void> => ClearSessionCache(),
};
