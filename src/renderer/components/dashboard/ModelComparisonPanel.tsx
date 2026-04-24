import { useEffect, useMemo, useState } from 'react';

import { api } from '@renderer/api';
import { cn } from '@renderer/lib/utils';
import { createLogger } from '@shared/utils/logger';
import { formatTokensCompact } from '@shared/utils/tokenFormatting';
import { ChevronDown, ChevronUp } from 'lucide-react';

import type { ModelComparisonEntry, ModelComparisonResponse } from '@shared/types';

import { registerDashboardWidget } from './widgetContract';

const logger = createLogger('Component:ModelComparisonPanel');

registerDashboardWidget({
  id: 'model-comparison',
  title: 'Model Comparison',
  category: 'analytics',
  defaultSize: { cols: 6, rows: 2 },
  minSize: { cols: 4, rows: 2 },
  maxSize: { cols: 8, rows: 3 },
  defaultVisible: true,
});

type SortKey =
  | 'displayName'
  | 'sessionCount'
  | 'totalCostUsd'
  | 'tokensPerSession'
  | 'costPerMillionTokens'
  | 'toolCallsPerSession'
  | 'errorRate'
  | 'avgResponseMs';

type SortDir = 'asc' | 'desc';

const SORT_STORAGE_KEY = 'cdt.analytics.modelComparisonSort';
const DEFAULT_WINDOW_DAYS = 14;

function loadSort(): { key: SortKey; dir: SortDir } {
  if (typeof window === 'undefined') return { key: 'sessionCount', dir: 'desc' };
  try {
    const raw = window.localStorage.getItem(SORT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { key: SortKey; dir: SortDir };
      if (parsed.key && (parsed.dir === 'asc' || parsed.dir === 'desc')) return parsed;
    }
  } catch {
    /* ignore */
  }
  return { key: 'sessionCount', dir: 'desc' };
}

function saveSort(sort: { key: SortKey; dir: SortDir }): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sort));
  } catch {
    /* ignore */
  }
}

function formatCost(usd: number): string {
  if (usd >= 100) return `$${usd.toFixed(0)}`;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

interface MiniBarsProps {
  values: number[];
}

const MiniBars = ({ values }: Readonly<MiniBarsProps>): React.JSX.Element => {
  const max = Math.max(...values, 1);
  return (
    <div className="flex h-4 items-end gap-[2px]">
      {values.map((v, i) => (
        <span
          key={i}
          className="w-1 rounded-[1px] bg-indigo-500/80"
          style={{ height: `${Math.max((v / max) * 100, 5)}%` }}
        />
      ))}
    </div>
  );
};

interface HeaderCellProps {
  label: string;
  field: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right';
}

const HeaderCell = ({
  label,
  field,
  sort,
  onSort,
  align = 'right',
}: Readonly<HeaderCellProps>): React.JSX.Element => {
  const isActive = sort.key === field;
  return (
    <th
      onClick={() => onSort(field)}
      className={cn(
        'text-text-muted cursor-pointer select-none px-2 py-1.5 text-[10px] font-medium hover:text-text',
        align === 'right' ? 'text-right' : 'text-left'
      )}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive && (sort.dir === 'asc' ? <ChevronUp className="size-2.5" /> : <ChevronDown className="size-2.5" />)}
      </span>
    </th>
  );
};

function sortEntries(
  entries: ModelComparisonEntry[],
  key: SortKey,
  dir: SortDir
): ModelComparisonEntry[] {
  const factor = dir === 'asc' ? 1 : -1;
  return [...entries].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * factor;
    return ((av as number) - (bv as number)) * factor;
  });
}

export const ModelComparisonPanel = (): React.JSX.Element => {
  const [data, setData] = useState<ModelComparisonResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState(loadSort);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getModelComparison(DEFAULT_WINDOW_DAYS)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        logger.error('Failed to load model comparison', err);
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSort = (key: SortKey): void => {
    setSort((prev) => {
      const next =
        prev.key === key
          ? { key, dir: prev.dir === 'asc' ? ('desc' as const) : ('asc' as const) }
          : { key, dir: 'desc' as const };
      saveSort(next);
      return next;
    });
  };

  const rows = useMemo(
    () => (data ? sortEntries(data.models, sort.key, sort.dir) : []),
    [data, sort]
  );

  if (loading) {
    return (
      <div className="border-border bg-background/50 animate-pulse rounded-xs border p-4">
        <div className="bg-muted-foreground/10 mb-3 h-3 w-24 rounded-xs" />
        <div className="bg-muted-foreground/5 h-24 rounded-xs" />
      </div>
    );
  }

  if (error || !data || data.models.length === 0) {
    return (
      <div className="border-border bg-background/50 rounded-xs border p-4">
        <p className="text-text-muted text-[11px]">Model Comparison</p>
        <p className="text-text-muted mt-2 text-[10px]">
          {error ?? 'No model usage recorded in this range.'}
        </p>
      </div>
    );
  }

  return (
    <div className="border-border bg-background/50 rounded-xs border p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-text text-sm font-medium">Model Comparison</h3>
          <p className="text-text-muted mt-0.5 text-[10px]">
            Trailing {DEFAULT_WINDOW_DAYS} days · click a column to sort (persists)
          </p>
        </div>
        <span className="text-text-muted text-[10px]">{data.totalSessions} sessions</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="border-border/40 border-b">
              <HeaderCell label="Model" field="displayName" sort={sort} onSort={handleSort} align="left" />
              <HeaderCell label="Sessions" field="sessionCount" sort={sort} onSort={handleSort} />
              <HeaderCell label="Total cost" field="totalCostUsd" sort={sort} onSort={handleSort} />
              <HeaderCell label="Tokens/sess" field="tokensPerSession" sort={sort} onSort={handleSort} />
              <HeaderCell label="$/MTok" field="costPerMillionTokens" sort={sort} onSort={handleSort} />
              <HeaderCell label="Tools/sess" field="toolCallsPerSession" sort={sort} onSort={handleSort} />
              <HeaderCell label="Error rate" field="errorRate" sort={sort} onSort={handleSort} />
              <HeaderCell label="Avg resp" field="avgResponseMs" sort={sort} onSort={handleSort} />
              <th className="text-text-muted px-2 py-1.5 text-left text-[10px] font-medium">7d</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.model} className="border-border/20 border-b last:border-b-0">
                <td className="text-text px-2 py-1.5 text-left font-medium">{m.displayName}</td>
                <td className="text-text-secondary px-2 py-1.5 text-right font-mono tabular-nums">
                  {m.sessionCount}
                </td>
                <td className="text-text-secondary px-2 py-1.5 text-right font-mono tabular-nums">
                  {formatCost(m.totalCostUsd)}
                </td>
                <td className="text-text-secondary px-2 py-1.5 text-right font-mono tabular-nums">
                  {formatTokensCompact(m.tokensPerSession)}
                </td>
                <td className="text-text-secondary px-2 py-1.5 text-right font-mono tabular-nums">
                  {formatCost(m.costPerMillionTokens)}
                </td>
                <td className="text-text-secondary px-2 py-1.5 text-right font-mono tabular-nums">
                  {m.toolCallsPerSession.toFixed(1)}
                </td>
                <td
                  className={cn(
                    'px-2 py-1.5 text-right font-mono tabular-nums',
                    m.errorRate > 0.1 ? 'text-rose-400' : 'text-text-secondary'
                  )}
                >
                  {(m.errorRate * 100).toFixed(1)}%
                </td>
                <td className="text-text-secondary px-2 py-1.5 text-right font-mono tabular-nums">
                  {formatDurationMs(m.avgResponseMs)}
                </td>
                <td className="px-2 py-1.5">
                  <MiniBars values={m.dailySessions} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
