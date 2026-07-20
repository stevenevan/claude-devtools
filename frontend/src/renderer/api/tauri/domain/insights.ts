import type {
  ErrorClustersResponse,
  ErrorHotspotsResponse,
  FileGraphResponse,
  ToolAnalyticsResponse,
  ToolTimeHeatmapResponse,
} from '@shared/types';

import { call } from '../invoke';

// Flat insights data methods (DesktopAPI top-level, W9 — closes the W8 deferral).
// Each mirrors analyticsservice.Get* → insights.Compute*. No reviveDates (the
// legacy adapter revives none of these). linkToolCalls has no DesktopAPI slot and is
// intentionally NOT here (server-side-only, see tokenizer.rs / W8).
export const insightsCommands = {
  getFileGraph: (projectId: string, sessionId: string): Promise<FileGraphResponse> =>
    call<FileGraphResponse>('get_file_graph', { projectId, sessionId }),
  getToolAnalytics: (projectId: string, days: number): Promise<ToolAnalyticsResponse> =>
    call<ToolAnalyticsResponse>('get_tool_analytics', { projectId, days }),
  getToolTimeHeatmap: (
    projectId: string,
    days: number,
    toolFilter?: string | null
  ): Promise<ToolTimeHeatmapResponse> =>
    call<ToolTimeHeatmapResponse>('get_tool_time_heatmap', {
      projectId,
      days,
      toolFilter: toolFilter ?? null,
    }),
  getErrorHotspots: (
    projectId: string,
    days: number,
    minOccurrences: number
  ): Promise<ErrorHotspotsResponse> =>
    call<ErrorHotspotsResponse>('get_error_hotspots', { projectId, days, minOccurrences }),
  getErrorClusters: (
    projectId: string,
    days: number,
    minClusterSize: number
  ): Promise<ErrorClustersResponse> =>
    call<ErrorClustersResponse>('get_error_clusters', { projectId, days, minClusterSize }),
};
