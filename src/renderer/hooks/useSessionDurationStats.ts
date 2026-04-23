import { useEffect, useState } from 'react';

import { api } from '@renderer/api';
import { createLogger } from '@shared/utils/logger';

import type { SessionDurationResponse } from '@shared/types';

const logger = createLogger('Hook:useSessionDurationStats');

export interface SessionDurationStatsResult {
  data: SessionDurationResponse | null;
  loading: boolean;
  error: string | null;
}

export function useSessionDurationStats(days: number): SessionDurationStatsResult {
  const [data, setData] = useState<SessionDurationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getSessionDurationStats(days)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        logger.error('Failed to load session duration stats', err);
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  return { data, loading, error };
}
