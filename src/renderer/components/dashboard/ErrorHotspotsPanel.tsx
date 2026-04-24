import { useEffect, useState } from 'react';

import { api } from '@renderer/api';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { createLogger } from '@shared/utils/logger';
import { formatDistanceToNowStrict } from 'date-fns';
import { AlertTriangle, Loader2 } from 'lucide-react';

import type { ErrorHotspotsResponse, RepeatedToolError } from '@shared/types';

import { ErrorClustersPanel } from './ErrorClustersPanel';

const logger = createLogger('Component:ErrorHotspotsPanel');

interface ErrorHotspotsPanelProps {
  days: number;
}

export const ErrorHotspotsPanel = ({
  days,
}: Readonly<ErrorHotspotsPanelProps>): React.JSX.Element | null => {
  const selectedProjectId = useStore((s) => s.selectedProjectId);
  const navigateToSession = useStore((s) => s.navigateToSession);

  const [data, setData] = useState<ErrorHotspotsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedProjectId) {
      setData(null);
      return;
    }
    let cancelled = false;
    const run = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.getErrorHotspots(selectedProjectId, days, 3);
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) {
          logger.error('Failed to fetch error hotspots:', err);
          setError(err instanceof Error ? err.message : 'Failed to load error hotspots');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [selectedProjectId, days]);

  if (!selectedProjectId) {
    return null;
  }

  return (
    <div className="border-border bg-background/50 rounded-xs border p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-foreground text-sm font-medium">Error Hotspots</h3>
          <p className="text-muted-foreground mt-0.5 text-[10px]">
            Tool errors repeated across 3+ sessions in the last {days} days
          </p>
        </div>
        {loading && <Loader2 className="text-muted-foreground size-4 animate-spin" />}
      </div>

      {error && (
        <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {!loading && !error && data && data.repeatedErrors.length === 0 && (
        <p className="text-muted-foreground py-6 text-center text-xs">
          No repeated errors found.
        </p>
      )}

      {data && data.repeatedErrors.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {data.repeatedErrors.map((hotspot, idx) => (
            <HotspotRow
              key={`${hotspot.toolName}-${idx}`}
              hotspot={hotspot}
              onOpenSession={(sessionId) =>
                navigateToSession(selectedProjectId, sessionId)
              }
            />
          ))}
        </div>
      )}

      <ErrorClustersPanel projectId={selectedProjectId} days={days} />
    </div>
  );
};

const HotspotRow = ({
  hotspot,
  onOpenSession,
}: Readonly<{
  hotspot: RepeatedToolError;
  onOpenSession: (sessionId: string) => void;
}>): React.JSX.Element => {
  const [expanded, setExpanded] = useState(false);
  const lastSeen = formatDistanceToNowStrict(new Date(hotspot.lastSeenMs), {
    addSuffix: true,
  });

  return (
    <div className="border-border/60 bg-card rounded-md border px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-foreground font-mono text-xs font-semibold">
                {hotspot.toolName}
              </span>
              <span className="border-border bg-background text-muted-foreground rounded-sm border px-1.5 py-0.5 text-[10px]">
                {hotspot.occurrences}× · {hotspot.sessionCount} sessions
              </span>
            </div>
            <p className="text-muted-foreground mt-1 line-clamp-2 text-xs break-words">
              {hotspot.errorPrefix}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-muted-foreground text-[10px]">{lastSeen}</span>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className={cn(
              'text-muted-foreground hover:text-foreground text-[11px] underline'
            )}
          >
            {expanded ? 'Hide' : 'View'} sessions
          </button>
        </div>
      </div>
      {expanded && (
        <div className="border-border/60 mt-2 flex flex-wrap gap-1 border-t pt-2">
          {hotspot.sessionIds.map((sessionId) => (
            <button
              key={sessionId}
              type="button"
              onClick={() => onOpenSession(sessionId)}
              className="border-border hover:bg-surface-raised text-muted-foreground hover:text-foreground rounded-sm border px-1.5 py-0.5 font-mono text-[10px]"
              title={sessionId}
            >
              {sessionId.slice(0, 8)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
