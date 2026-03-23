/**
 * Hook that fetches pre-aggregated analytics data from the Rust backend.
 * The backend does all heavy computation; this hook just assigns colors for display.
 */

import { useEffect, useRef, useState } from 'react';

import { api } from '@renderer/api';
import { createLogger } from '@shared/utils/logger';

import type {
  AnalyticsResponse,
  BucketGranularity,
  ModelUsageEntry,
  ProjectUsageEntry,
  ScheduleEventEntry,
  TimeBucketUsage,
  TopSessionEntry,
} from '@shared/types';

const logger = createLogger('Hook:useAnalyticsData');

// =============================================================================
// Types
// =============================================================================

export type { BucketGranularity };

export interface ProjectUsage extends ProjectUsageEntry {
  color: string;
}

export interface ModelUsage extends ModelUsageEntry {
  color: string;
}

export interface ScheduleEvent extends ScheduleEventEntry {
  color: string;
}

export interface AnalyticsData {
  timeBuckets: TimeBucketUsage[];
  projectUsage: ProjectUsage[];
  modelUsage: ModelUsage[];
  scheduleEvents: ScheduleEvent[];
  topSessions: TopSessionEntry[];
  totalTokens: number;
  totalCost: number;
  totalSessions: number;
  avgTokensPerSession: number;
  avgCostPerSession: number;
  granularity: BucketGranularity;
  loading: boolean;
  error: string | null;
  days: number;
  setDays: (days: number) => void;
}

// =============================================================================
// Constants
// =============================================================================

/** Max supported range */
export const MAX_DAYS = 90;

const PROJECT_COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#f59e0b',
  '#10b981',
  '#06b6d4',
  '#f97316',
  '#84cc16',
  '#ef4444',
  '#3b82f6',
  '#14b8a6',
  '#a855f7',
];

const MODEL_COLORS = [
  '#f59e0b',
  '#6366f1',
  '#10b981',
  '#ec4899',
  '#06b6d4',
  '#f97316',
  '#8b5cf6',
  '#84cc16',
];

// =============================================================================
// Hook
// =============================================================================

export function useAnalyticsData(): AnalyticsData {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(1);
  const fetchIdRef = useRef(0);

  useEffect(() => {
    const currentFetchId = ++fetchIdRef.current;
    let cancelled = false;

    const run = async (): Promise<void> => {
      setLoading(true);
      setError(null);

      try {
        const result = await api.getAnalytics(days);
        if (!cancelled && currentFetchId === fetchIdRef.current) {
          setData(result);
        }
      } catch (err) {
        if (!cancelled && currentFetchId === fetchIdRef.current) {
          logger.error('Failed to fetch analytics:', err);
          setError(err instanceof Error ? err.message : 'Failed to load analytics');
        }
      } finally {
        if (!cancelled && currentFetchId === fetchIdRef.current) {
          setLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [days]);

  // Assign colors
  const projectUsage: ProjectUsage[] = (data?.projectUsage ?? []).map((p, i) => ({
    ...p,
    color: PROJECT_COLORS[i % PROJECT_COLORS.length],
  }));

  const projectColorMap = new Map(projectUsage.map((p) => [p.projectName, p.color]));

  const modelUsage: ModelUsage[] = (data?.modelUsage ?? []).map((m, i) => ({
    ...m,
    color: MODEL_COLORS[i % MODEL_COLORS.length],
  }));

  const scheduleEvents: ScheduleEvent[] = (data?.scheduleEvents ?? []).map((e) => ({
    ...e,
    color: projectColorMap.get(e.projectName) ?? '#6366f1',
  }));

  return {
    timeBuckets: data?.timeBuckets ?? [],
    projectUsage,
    modelUsage,
    scheduleEvents,
    topSessions: data?.topSessions ?? [],
    totalTokens: data?.totalTokens ?? 0,
    totalCost: data?.totalCost ?? 0,
    totalSessions: data?.totalSessions ?? 0,
    avgTokensPerSession: data?.avgTokensPerSession ?? 0,
    avgCostPerSession: data?.avgCostPerSession ?? 0,
    granularity: data?.granularity ?? 'daily',
    loading,
    error,
    days,
    setDays,
  };
}
