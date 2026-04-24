import { useEffect, useState } from 'react';

import { api } from '@renderer/api';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { createLogger } from '@shared/utils/logger';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';

import type { ErrorClustersResponse } from '@shared/types';

const logger = createLogger('Component:ErrorClustersPanel');

const DEFAULT_MIN_CLUSTER_SIZE = 2;

interface ErrorClustersPanelProps {
  projectId: string | null;
  days: number;
}

export const ErrorClustersPanel = ({
  projectId,
  days,
}: Readonly<ErrorClustersPanelProps>): React.JSX.Element | null => {
  const [data, setData] = useState<ErrorClustersResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const navigateToSession = useStore((s) => s.navigateToSession);

  useEffect(() => {
    if (!projectId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getErrorClusters(projectId, days, DEFAULT_MIN_CLUSTER_SIZE)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        logger.error('Failed to load error clusters', err);
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, days]);

  const toggle = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!projectId) return null;

  return (
    <div className="border-border bg-background/50 mt-4 rounded-xs border p-4">
      <div className="mb-3">
        <h3 className="text-text text-sm font-medium">Error Clusters</h3>
        <p className="text-text-muted mt-0.5 text-[10px]">
          Near-duplicate tool errors grouped via shingle hash + union-find
        </p>
      </div>

      {loading && (
        <p className="text-text-muted py-4 text-center text-[10px]">Loading clusters…</p>
      )}
      {error && (
        <p className="text-text-muted py-4 text-center text-[10px]">
          Failed to load clusters: {error}
        </p>
      )}
      {!loading && !error && data && data.clusters.length === 0 && (
        <p className="text-text-muted py-4 text-center text-[10px]">
          No recurring error clusters in this range
        </p>
      )}

      {!loading && !error && data && data.clusters.length > 0 && (
        <div className="flex flex-col gap-1">
          {data.clusters.map((cluster) => {
            const isOpen = expanded.has(cluster.id);
            return (
              <div
                key={cluster.id}
                className="border-border/50 overflow-hidden rounded-xs border"
              >
                <button
                  onClick={() => toggle(cluster.id)}
                  className="hover:bg-surface-raised flex w-full items-center gap-2 px-3 py-2 text-left"
                >
                  {isOpen ? (
                    <ChevronDown className="text-text-muted size-3 shrink-0" />
                  ) : (
                    <ChevronRight className="text-text-muted size-3 shrink-0" />
                  )}
                  <AlertTriangle className="size-3 shrink-0 text-amber-400" />
                  <span className="text-text min-w-0 flex-1 truncate text-[11px]">
                    {cluster.representative}
                  </span>
                  <span className="text-text-muted shrink-0 text-[10px] tabular-nums">
                    {cluster.primaryTool} · {cluster.occurrenceCount} ·{' '}
                    {cluster.sessionCount} session{cluster.sessionCount === 1 ? '' : 's'}
                  </span>
                </button>
                {isOpen && (
                  <div className="border-border/40 bg-surface-raised/40 border-t">
                    {cluster.members.map((m, i) => (
                      <button
                        key={`${m.sessionId}-${i}`}
                        onClick={() => navigateToSession(projectId, m.sessionId)}
                        className={cn(
                          'hover:bg-surface-raised flex w-full items-center gap-3 border-b border-border/20 px-3 py-1.5 text-left last:border-b-0',
                        )}
                      >
                        <span className="text-text-muted shrink-0 text-[9px] tabular-nums">
                          {m.toolName}
                        </span>
                        <span className="text-text-secondary min-w-0 flex-1 truncate text-[10px]">
                          {m.errorPrefix}
                        </span>
                        <span className="text-text-muted shrink-0 text-[9px]">
                          {new Date(m.timestampMs).toLocaleString()}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
