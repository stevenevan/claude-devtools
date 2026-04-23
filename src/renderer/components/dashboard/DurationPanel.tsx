import { useEffect, useMemo } from 'react';

import { useSessionDurationStats } from '@renderer/hooks/useSessionDurationStats';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { AlertTriangle } from 'lucide-react';

import type { SessionDurationEntry } from '@shared/types';

import { registerDashboardWidget } from './widgetContract';

registerDashboardWidget({
  id: 'duration-panel',
  title: 'Session Duration',
  category: 'analytics',
  defaultSize: { cols: 4, rows: 1 },
  minSize: { cols: 2, rows: 1 },
  maxSize: { cols: 8, rows: 2 },
  defaultVisible: true,
});

const DEFAULT_WINDOW_DAYS = 14;
const HISTOGRAM_HEIGHT = 60;
const OUTLIER_DISPLAY_LIMIT = 6;

function formatMs(ms: number): string {
  if (ms <= 0) return '0s';
  const m = ms / 60_000;
  if (m < 60) return `${m.toFixed(1)}m`;
  const h = m / 60;
  return `${h.toFixed(1)}h`;
}

function formatBucketRange(index: number, width: number): string {
  return `${formatMs(index * width)} – ${formatMs((index + 1) * width)}`;
}

interface OutlierRowProps {
  session: SessionDurationEntry;
  p95Ms: number;
  onOpen: () => void;
}

const OutlierRow = ({ session, p95Ms, onOpen }: Readonly<OutlierRowProps>): React.JSX.Element => {
  const ratio = p95Ms > 0 ? session.wallMs / p95Ms : 1;
  return (
    <button
      onClick={onOpen}
      className="border-border/40 hover:bg-surface-raised flex w-full items-center justify-between rounded-xs border px-2 py-1.5 text-left text-[10px] transition-colors"
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <AlertTriangle className="size-3 shrink-0 text-amber-400" />
        <span className="text-text min-w-0 truncate">{session.title}</span>
      </span>
      <span className="text-text-muted ml-2 shrink-0 tabular-nums">
        {formatMs(session.wallMs)} · {ratio.toFixed(1)}× p95
      </span>
    </button>
  );
};

export const DurationPanel = (): React.JSX.Element => {
  const { data, loading, error } = useSessionDurationStats(DEFAULT_WINDOW_DAYS);
  const setDurationOutlierSessionIds = useStore((s) => s.setDurationOutlierSessionIds);
  const navigateToSession = useStore((s) => s.navigateToSession);

  useEffect(() => {
    if (data) {
      setDurationOutlierSessionIds(data.outlierSessionIds);
    }
  }, [data, setDurationOutlierSessionIds]);

  const { outlierSessions, histogramBucketWidth } = useMemo(() => {
    if (!data) return { outlierSessions: [] as SessionDurationEntry[], histogramBucketWidth: 0 };
    const outlierSet = new Set(data.outlierSessionIds);
    const filtered = data.sessions.filter((s) => outlierSet.has(s.sessionId));
    const width = data.histogram.length > 0 ? data.histogramMaxMs / data.histogram.length : 0;
    return { outlierSessions: filtered, histogramBucketWidth: width };
  }, [data]);

  if (loading) {
    return (
      <div className="border-border bg-background/50 animate-pulse rounded-xs border p-4">
        <div className="bg-muted-foreground/10 mb-3 h-3 w-24 rounded-xs" />
        <div className="bg-muted-foreground/5 h-16 rounded-xs" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="border-border bg-background/50 rounded-xs border p-4">
        <p className="text-text-muted text-[11px]">Session Duration</p>
        <p className="text-text-muted mt-2 text-[10px]">
          {error ?? 'No duration data available.'}
        </p>
      </div>
    );
  }

  const maxCount = data.histogram.reduce((m, v) => Math.max(m, v), 0);

  return (
    <div className="border-border bg-background/50 rounded-xs border p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-text text-sm font-medium">Session Duration</h3>
          <p className="text-text-muted mt-0.5 text-[10px]">
            Trailing {DEFAULT_WINDOW_DAYS} days · wall-clock histogram + outliers
          </p>
        </div>
        <div className="text-text-muted text-right text-[10px]">
          p50 {formatMs(data.wallStats.p50Ms)} · p95 {formatMs(data.wallStats.p95Ms)} · max{' '}
          {formatMs(data.wallStats.maxMs)}
        </div>
      </div>

      <div className="flex items-end gap-[2px]" style={{ height: HISTOGRAM_HEIGHT }}>
        {data.histogram.map((count, i) => {
          const pct = maxCount > 0 ? count / maxCount : 0;
          return (
            <div
              key={i}
              className={cn(
                'flex-1 rounded-[2px]',
                count > 0 ? 'bg-indigo-500/70' : 'bg-indigo-500/10'
              )}
              style={{ height: `${Math.max(pct * 100, count > 0 ? 8 : 2)}%` }}
              title={`${formatBucketRange(i, histogramBucketWidth)} · ${count} session${count === 1 ? '' : 's'}`}
            />
          );
        })}
      </div>
      <div className="text-text-muted mt-1 flex justify-between text-[9px] tabular-nums">
        <span>0</span>
        <span>{formatMs(data.histogramMaxMs)}</span>
      </div>

      <div className="mt-4">
        <h4 className="text-text-muted mb-2 text-[10px] uppercase tracking-wider">
          Outliers ({outlierSessions.length})
        </h4>
        {outlierSessions.length === 0 ? (
          <p className="text-text-muted text-[10px]">No sessions exceed p95 × 1.5</p>
        ) : (
          <div className="flex flex-col gap-1">
            {outlierSessions.slice(0, OUTLIER_DISPLAY_LIMIT).map((s) => (
              <OutlierRow
                key={s.sessionId}
                session={s}
                p95Ms={data.wallStats.p95Ms}
                onOpen={() => navigateToSession(s.projectId, s.sessionId)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
