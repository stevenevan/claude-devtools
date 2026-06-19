// Analytics Types (returned by Rust get_analytics command)

export interface TimeBucketUsage {
  key: string;
  label: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  sessionCount: number;
}

export interface ProjectUsageEntry {
  projectName: string;
  totalTokens: number;
  costUsd: number;
  sessionCount: number;
}

export interface ModelUsageEntry {
  model: string;
  displayName: string;
  totalTokens: number;
  costUsd: number;
  sessionCount: number;
}

export interface ScheduleEventEntry {
  id: string;
  projectName: string;
  sessionTitle: string;
  startTime: number;
  endTime: number;
  projectId: string;
}

export interface TopSessionEntry {
  projectName: string;
  title: string;
  totalTokens: number;
  costUsd: number;
  durationMs: number;
  model?: string;
}

export type BucketGranularity = 'hourly' | 'daily' | 'weekly' | 'monthly';

export interface ToolUsageSummary {
  toolName: string;
  callCount: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  errorRate: number;
  avgDurationMs: number;
  medianTokenCost: number;
}

export interface ToolAnalyticsResponse {
  tools: ToolUsageSummary[];
  totalCalls: number;
  totalErrors: number;
  scannedSessions: number;
}

export interface ToolTimeHeatmapCell {
  dayOfWeek: number;
  hour: number;
  callCount: number;
  topTool: string | null;
}

export interface ToolTimeHeatmapResponse {
  cells: ToolTimeHeatmapCell[];
  totalCalls: number;
  toolNames: string[];
}

export interface RepeatedToolError {
  toolName: string;
  errorPrefix: string;
  occurrences: number;
  sessionCount: number;
  sessionIds: string[];
  lastSeenMs: number;
}

export interface ErrorHotspotsResponse {
  repeatedErrors: RepeatedToolError[];
  scannedSessions: number;
}

export interface ErrorClusterMember {
  sessionId: string;
  toolName: string;
  errorPrefix: string;
  timestampMs: number;
}

export interface ErrorCluster {
  id: string;
  representative: string;
  primaryTool: string;
  toolNames: string[];
  occurrenceCount: number;
  sessionCount: number;
  lastSeenMs: number;
  members: ErrorClusterMember[];
}

export interface ErrorClustersResponse {
  clusters: ErrorCluster[];
  scannedSessions: number;
}

export interface AggregatedSessionTodos {
  projectId: string;
  sessionId: string;
  updatedAt: number;
  items: unknown;
}

export interface AnalyticsResponse {
  timeBuckets: TimeBucketUsage[];
  projectUsage: ProjectUsageEntry[];
  modelUsage: ModelUsageEntry[];
  scheduleEvents: ScheduleEventEntry[];
  topSessions: TopSessionEntry[];
  totalTokens: number;
  totalCost: number;
  totalSessions: number;
  avgTokensPerSession: number;
  avgCostPerSession: number;
  granularity: BucketGranularity;
  toolSummary?: ToolAnalyticsResponse;
}

export interface CostForecast {
  projectedDailyCostUsd: number;
  projectedWeeklyCostUsd: number;
  trendSlopeUsdPerDay: number;
  sampleDays: number;
  recentDailyCosts: number[];
}

export interface ProductivityDay {
  date: string;
  sessionsStarted: number;
  sessionsCompleted: number;
  activeMs: number;
  toolCalls: number;
  tokensP50: number;
  tokensP95: number;
}

export interface ProductivityTotals {
  sessionsStarted: number;
  sessionsCompleted: number;
  activeMs: number;
  toolCalls: number;
  tokensP50: number;
  tokensP95: number;
}

export interface ProductivityMetrics {
  days: ProductivityDay[];
  totals: ProductivityTotals;
}

export interface SessionDurationEntry {
  sessionId: string;
  projectId: string;
  projectName: string;
  title: string;
  wallMs: number;
  activeMs: number;
  startedMs: number;
}

export interface DurationStats {
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  outlierThresholdMs: number;
}

export interface SessionDurationResponse {
  sessions: SessionDurationEntry[];
  histogram: number[];
  histogramMaxMs: number;
  wallStats: DurationStats;
  activeStats: DurationStats;
  outlierSessionIds: string[];
}

export interface ModelComparisonEntry {
  model: string;
  displayName: string;
  family: 'opus' | 'sonnet' | 'haiku' | 'other';
  sessionCount: number;
  totalTokens: number;
  totalCostUsd: number;
  tokensPerSession: number;
  costPerSession: number;
  costPerMillionTokens: number;
  toolCallsPerSession: number;
  errorRate: number;
  avgResponseMs: number;
  dailySessions: number[];
}

export interface ModelComparisonResponse {
  models: ModelComparisonEntry[];
  totalSessions: number;
}

export interface FileGraphNode {
  path: string;
  readCount: number;
  editCount: number;
  writeCount: number;
  totalInteractions: number;
  turnIndices: number[];
}

export interface FileGraphEdge {
  from: string;
  to: string;
  kind: string;
  weight: number;
}

export interface FileGraphResponse {
  nodes: FileGraphNode[];
  edges: FileGraphEdge[];
}
