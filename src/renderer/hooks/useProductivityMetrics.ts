import { useEffect, useRef, useState } from 'react';

import { api } from '@renderer/api';
import { createLogger } from '@shared/utils/logger';

import type { ProductivityMetrics } from '@shared/types';

const logger = createLogger('Hook:useProductivityMetrics');

export interface ProductivityMetricsResult {
  metrics: ProductivityMetrics | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useProductivityMetrics(days: number): ProductivityMetricsResult {
  const [metrics, setMetrics] = useState<ProductivityMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const fetchIdRef = useRef(0);

  useEffect(() => {
    const id = ++fetchIdRef.current;
    let cancelled = false;

    setLoading(true);
    setError(null);
    api
      .getProductivityMetrics(days)
      .then((result) => {
        if (!cancelled && id === fetchIdRef.current) {
          setMetrics(result);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled && id === fetchIdRef.current) {
          logger.error('Failed to load productivity metrics', err);
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled && id === fetchIdRef.current) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [days, nonce]);

  return {
    metrics,
    loading,
    error,
    refresh: () => setNonce((n) => n + 1),
  };
}
