import { useEffect, useRef, useState } from 'react';

import { api } from '@renderer/api';
import type { ToolAnalyticsResponse } from '@shared/types';
import { createLogger } from '@shared/utils/logger';

const logger = createLogger('Hook:useToolAnalyticsData');

export interface ToolAnalyticsData {
  tools: ToolAnalyticsResponse['tools'];
  totalCalls: number;
  totalErrors: number;
  scannedSessions: number;
  loading: boolean;
  error: string | null;
}

export function useToolAnalyticsData(
  projectId: string | null,
  days: number
): ToolAnalyticsData {
  const [data, setData] = useState<ToolAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchIdRef = useRef(0);

  useEffect(() => {
    if (!projectId) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    const currentFetchId = ++fetchIdRef.current;
    let cancelled = false;

    const run = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.getToolAnalytics(projectId, days);
        if (!cancelled && currentFetchId === fetchIdRef.current) {
          setData(result);
        }
      } catch (err) {
        if (!cancelled && currentFetchId === fetchIdRef.current) {
          logger.error('Failed to fetch tool analytics:', err);
          setError(err instanceof Error ? err.message : 'Failed to load tool analytics');
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
  }, [projectId, days]);

  return {
    tools: data?.tools ?? [],
    totalCalls: data?.totalCalls ?? 0,
    totalErrors: data?.totalErrors ?? 0,
    scannedSessions: data?.scannedSessions ?? 0,
    loading,
    error,
  };
}
