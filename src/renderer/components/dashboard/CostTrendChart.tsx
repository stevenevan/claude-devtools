import { useMemo } from 'react';

import { cn } from '@renderer/lib/utils';
import { TrendingDown, TrendingUp } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { TimeBucketUsage } from '@shared/types';

interface CostTrendChartProps {
  buckets: TimeBucketUsage[];
  bucketNoun: string;
}

interface CostSummary {
  thisWeekCost: number;
  lastWeekCost: number;
  deltaPct: number | null;
}

function computeCostSummary(buckets: TimeBucketUsage[]): CostSummary {
  const n = buckets.length;
  if (n === 0) {
    return { thisWeekCost: 0, lastWeekCost: 0, deltaPct: null };
  }
  const lastIdx = n;
  const thisWeekStart = Math.max(0, lastIdx - 7);
  const lastWeekStart = Math.max(0, lastIdx - 14);
  const thisWeek = buckets.slice(thisWeekStart, lastIdx).reduce((sum, b) => sum + b.costUsd, 0);
  const lastWeek = buckets
    .slice(lastWeekStart, thisWeekStart)
    .reduce((sum, b) => sum + b.costUsd, 0);

  const deltaPct = lastWeek > 0 ? ((thisWeek - lastWeek) / lastWeek) * 100 : null;

  return { thisWeekCost: thisWeek, lastWeekCost: lastWeek, deltaPct };
}

interface CustomAreaTooltipProps {
  active?: boolean;
  payload?: { payload: TimeBucketUsage }[];
}

const CustomAreaTooltip = ({
  active,
  payload,
}: Readonly<CustomAreaTooltipProps>): React.JSX.Element | null => {
  if (!active || !payload || payload.length === 0) return null;
  const bucket = payload[0].payload;
  return (
    <div className="border-border bg-popover text-foreground rounded-md border px-3 py-2 text-xs shadow-md">
      <div className="font-medium">{bucket.label}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-muted-foreground">Cost</span>
        <span className="font-mono">${bucket.costUsd.toFixed(4)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Sessions</span>
        <span className="font-mono">{bucket.sessionCount}</span>
      </div>
    </div>
  );
};

interface SummaryStatProps {
  label: string;
  value: string;
  delta?: number | null;
}

const SummaryStat = ({ label, value, delta }: Readonly<SummaryStatProps>): React.JSX.Element => {
  const hasDelta = typeof delta === 'number';
  const positive = hasDelta && delta > 0;
  const negative = hasDelta && delta < 0;
  return (
    <div className="border-border bg-background/50 flex flex-col gap-1 rounded-xs border p-3">
      <span className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
        {label}
      </span>
      <span className="text-foreground text-lg font-semibold">{value}</span>
      {hasDelta && (
        <span
          className={cn(
            'inline-flex items-center gap-1 text-[11px] font-medium',
            positive && 'text-emerald-400',
            negative && 'text-rose-400',
            !positive && !negative && 'text-muted-foreground'
          )}
        >
          {positive && <TrendingUp className="size-3" />}
          {negative && <TrendingDown className="size-3" />}
          {delta > 0 ? '+' : ''}
          {delta.toFixed(1)}% vs last week
        </span>
      )}
    </div>
  );
};

export const CostTrendChart = ({
  buckets,
  bucketNoun,
}: Readonly<CostTrendChartProps>): React.JSX.Element => {
  const summary = useMemo(() => computeCostSummary(buckets), [buckets]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryStat label="This week" value={`$${summary.thisWeekCost.toFixed(2)}`} />
        <SummaryStat label="Last week" value={`$${summary.lastWeekCost.toFixed(2)}`} />
        <SummaryStat
          label="Change"
          value={summary.deltaPct === null ? '—' : `${summary.deltaPct.toFixed(1)}%`}
          delta={summary.deltaPct}
        />
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={buckets} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: '#71717a' }}
            axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
            tickLine={false}
            minTickGap={12}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#71717a' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `$${v.toFixed(2)}`}
          />
          <Tooltip content={<CustomAreaTooltip />} />
          <Area
            type="monotone"
            dataKey="costUsd"
            name={`Cost per ${bucketNoun}`}
            stroke="#10b981"
            strokeWidth={2}
            fill="url(#costGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
