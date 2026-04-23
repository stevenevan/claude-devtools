import { useEffect, useMemo, useState } from 'react';

import { api } from '@renderer/api';
import { NativeSelect, NativeSelectOption } from '@renderer/components/ui/native-select';
import { cn } from '@renderer/lib/utils';
import { createLogger } from '@shared/utils/logger';

import type { ToolTimeHeatmapResponse } from '@shared/types';

const logger = createLogger('Component:ToolTimeHeatmap');

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface ToolTimeHeatmapProps {
  projectId: string | null;
  days: number;
}

function cellIntensity(count: number, max: number): number {
  if (max <= 0 || count <= 0) return 0;
  // Log-ish scale to keep busy hours readable when a few cells dwarf the rest.
  const normalized = Math.log1p(count) / Math.log1p(max);
  return Math.min(1, Math.max(0.05, normalized));
}

export const ToolTimeHeatmap = ({
  projectId,
  days,
}: Readonly<ToolTimeHeatmapProps>): React.JSX.Element | null => {
  const [data, setData] = useState<ToolTimeHeatmapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [toolFilter, setToolFilter] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getToolTimeHeatmap(projectId, days, toolFilter)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        logger.error('Failed to load tool time heatmap', err);
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, days, toolFilter]);

  const cellMap = useMemo(() => {
    const map = new Map<number, { count: number; topTool: string | null }>();
    if (!data) return map;
    for (const cell of data.cells) {
      map.set(cell.dayOfWeek * 24 + cell.hour, {
        count: cell.callCount,
        topTool: cell.topTool,
      });
    }
    return map;
  }, [data]);

  const maxCount = useMemo(
    () => (data ? data.cells.reduce((m, c) => Math.max(m, c.callCount), 0) : 0),
    [data]
  );

  if (!projectId) return null;

  return (
    <div className="border-border bg-background/50 mt-4 rounded-xs border p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-text text-sm font-medium">Tool Usage by Hour</h3>
          <p className="text-text-muted mt-0.5 text-[10px]">
            Call density across weekday × local hour · darker = more calls
          </p>
        </div>
        <NativeSelect
          size="sm"
          value={toolFilter ?? ''}
          onChange={(e) => setToolFilter(e.target.value || null)}
          disabled={!data || data.toolNames.length === 0}
        >
          <NativeSelectOption value="">All tools</NativeSelectOption>
          {(data?.toolNames ?? []).map((name) => (
            <NativeSelectOption key={name} value={name}>
              {name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      {loading && (
        <p className="text-text-muted py-4 text-center text-[10px]">Loading heatmap…</p>
      )}
      {error && (
        <p className="text-text-muted py-4 text-center text-[10px]">
          Failed to load heatmap: {error}
        </p>
      )}

      {!loading && !error && data && (
        <div>
          <div className="flex items-start gap-1 font-mono text-[9px]">
            <div className="text-text-muted flex flex-col gap-[3px] pt-3">
              {DAY_LABELS.map((label) => (
                <span key={label} className="h-4 leading-4">
                  {label}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-24 gap-[3px]" style={{ gridTemplateColumns: 'repeat(24, minmax(10px, 1fr))' }}>
              {/* Hour labels row */}
              {Array.from({ length: 24 }).map((_, h) => (
                <div key={`h-${h}`} className="text-text-muted h-3 text-center text-[8px] leading-3">
                  {h % 3 === 0 ? h : ''}
                </div>
              ))}
              {/* 7 rows × 24 cols */}
              {DAY_LABELS.map((_, day) =>
                Array.from({ length: 24 }).map((__, hour) => {
                  const cell = cellMap.get(day * 24 + hour);
                  const count = cell?.count ?? 0;
                  const intensity = cellIntensity(count, maxCount);
                  const title = count
                    ? `${DAY_LABELS[day]} ${hour}:00 · ${count} call${count === 1 ? '' : 's'}${
                        cell?.topTool ? ` · top: ${cell.topTool}` : ''
                      }`
                    : `${DAY_LABELS[day]} ${hour}:00 · no calls`;
                  return (
                    <div
                      key={`c-${day}-${hour}`}
                      className={cn('h-4 rounded-[1px] bg-violet-500')}
                      style={{ opacity: intensity }}
                      title={title}
                    />
                  );
                })
              )}
            </div>
          </div>

          <div className="text-text-muted mt-3 flex items-center justify-between text-[10px]">
            <span>{data.totalCalls} calls in range</span>
            <div className="flex items-center gap-1">
              <span>Less</span>
              {[0.12, 0.3, 0.55, 0.8, 1].map((alpha) => (
                <span
                  key={alpha}
                  className="size-3 rounded-[1px] bg-violet-500"
                  style={{ opacity: alpha }}
                />
              ))}
              <span>More</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
