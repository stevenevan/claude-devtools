import { useMemo } from 'react';

import { cn } from '@renderer/lib/utils';
import { useProductivityMetrics } from '@renderer/hooks/useProductivityMetrics';
import { formatTokensCompact } from '@shared/utils/tokenFormatting';
import { TrendingDown, TrendingUp } from 'lucide-react';

import type { ProductivityDay } from '@shared/types';

import { registerDashboardWidget } from './widgetContract';

registerDashboardWidget({
  id: 'productivity-panel',
  title: 'Productivity',
  category: 'analytics',
  defaultSize: { cols: 4, rows: 1 },
  minSize: { cols: 2, rows: 1 },
  maxSize: { cols: 8, rows: 2 },
  defaultVisible: true,
});

const DEFAULT_WINDOW_DAYS = 14;

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
}

const Sparkline = ({
  values,
  width = 80,
  height = 20,
}: Readonly<SparklineProps>): React.JSX.Element => {
  const n = values.length;
  if (n === 0) return <svg width={width} height={height} />;

  const max = Math.max(...values, 1);
  const stepX = n > 1 ? width / (n - 1) : width;
  const pointsStr = values
    .map((v, i) => `${(i * stepX).toFixed(1)},${(height - (v / max) * height).toFixed(1)}`)
    .join(' ');

  return (
    <svg width={width} height={height} className="text-text-muted">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        strokeLinejoin="round"
        points={pointsStr}
      />
    </svg>
  );
};

interface DeltaBadgeProps {
  deltaPct: number | null;
}

const DeltaBadge = ({ deltaPct }: Readonly<DeltaBadgeProps>): React.JSX.Element | null => {
  if (deltaPct === null || !Number.isFinite(deltaPct)) return null;
  const Icon = deltaPct >= 0 ? TrendingUp : TrendingDown;
  const tone = deltaPct >= 0 ? 'text-emerald-400' : 'text-rose-400';
  const label = `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(0)}%`;
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px]', tone)}>
      <Icon className="size-3" />
      {label}
    </span>
  );
};

interface KpiProps {
  label: string;
  value: string;
  sparklineValues: number[];
  deltaPct: number | null;
}

const Kpi = ({
  label,
  value,
  sparklineValues,
  deltaPct,
}: Readonly<KpiProps>): React.JSX.Element => (
  <div className="border-border/50 bg-background/50 flex flex-col gap-1 rounded-xs border p-3">
    <div className="flex items-baseline justify-between">
      <span className="text-text-muted text-[10px]">{label}</span>
      <DeltaBadge deltaPct={deltaPct} />
    </div>
    <span className="text-text text-lg font-medium tabular-nums">{value}</span>
    <Sparkline values={sparklineValues} />
  </div>
);

function formatDurationMs(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

function computeDeltaPct(current: number, prior: number): number | null {
  if (prior <= 0) return null;
  return ((current - prior) / prior) * 100;
}

interface WowWindows {
  thisWeek: ProductivityDay[];
  lastWeek: ProductivityDay[];
}

function splitWeeks(days: ProductivityDay[]): WowWindows {
  const n = days.length;
  const thisStart = Math.max(0, n - 7);
  const lastStart = Math.max(0, n - 14);
  return {
    thisWeek: days.slice(thisStart, n),
    lastWeek: days.slice(lastStart, thisStart),
  };
}

function sumStarted(days: ProductivityDay[]): number {
  return days.reduce((s, d) => s + d.sessionsStarted, 0);
}
function sumActive(days: ProductivityDay[]): number {
  return days.reduce((s, d) => s + d.activeMs, 0);
}
function sumTools(days: ProductivityDay[]): number {
  return days.reduce((s, d) => s + d.toolCalls, 0);
}
function avgP95(days: ProductivityDay[]): number {
  const nonZero = days.filter((d) => d.tokensP95 > 0);
  if (!nonZero.length) return 0;
  return nonZero.reduce((s, d) => s + d.tokensP95, 0) / nonZero.length;
}

export const ProductivityPanel = (): React.JSX.Element => {
  const { metrics, loading, error } = useProductivityMetrics(DEFAULT_WINDOW_DAYS);

  const derived = useMemo(() => {
    if (!metrics) {
      return null;
    }
    const { thisWeek, lastWeek } = splitWeeks(metrics.days);
    return {
      sessionsSpark: metrics.days.map((d) => d.sessionsStarted),
      activeSpark: metrics.days.map((d) => d.activeMs / 60_000),
      toolsSpark: metrics.days.map((d) => d.toolCalls),
      p95Spark: metrics.days.map((d) => d.tokensP95),
      sessionsDelta: computeDeltaPct(sumStarted(thisWeek), sumStarted(lastWeek)),
      activeDelta: computeDeltaPct(sumActive(thisWeek), sumActive(lastWeek)),
      toolsDelta: computeDeltaPct(sumTools(thisWeek), sumTools(lastWeek)),
      p95Delta: computeDeltaPct(avgP95(thisWeek), avgP95(lastWeek)),
    };
  }, [metrics]);

  if (loading) {
    return (
      <div className="border-border bg-background/50 animate-pulse rounded-xs border p-4">
        <div className="bg-muted-foreground/10 mb-3 h-3 w-24 rounded-xs" />
        <div className="bg-muted-foreground/5 h-16 w-full rounded-xs" />
      </div>
    );
  }

  if (error || !metrics) {
    return (
      <div className="border-border bg-background/50 rounded-xs border p-4">
        <p className="text-text-muted text-[11px]">Productivity</p>
        <p className="text-text-muted mt-2 text-[10px]">
          {error ?? 'No data available yet.'}
        </p>
      </div>
    );
  }

  const totals = metrics.totals;
  const d = derived;
  if (!d) return <div />;

  return (
    <div className="border-border bg-background/50 rounded-xs border p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-text text-sm font-medium">Productivity</h3>
          <p className="text-text-muted mt-0.5 text-[10px]">
            Trailing {DEFAULT_WINDOW_DAYS} days · week-over-week deltas
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Sessions started"
          value={totals.sessionsStarted.toLocaleString()}
          sparklineValues={d.sessionsSpark}
          deltaPct={d.sessionsDelta}
        />
        <Kpi
          label="Active time"
          value={formatDurationMs(totals.activeMs)}
          sparklineValues={d.activeSpark}
          deltaPct={d.activeDelta}
        />
        <Kpi
          label="Tool calls"
          value={totals.toolCalls.toLocaleString()}
          sparklineValues={d.toolsSpark}
          deltaPct={d.toolsDelta}
        />
        <Kpi
          label="Tokens p95"
          value={formatTokensCompact(totals.tokensP95)}
          sparklineValues={d.p95Spark}
          deltaPct={d.p95Delta}
        />
      </div>
    </div>
  );
};
