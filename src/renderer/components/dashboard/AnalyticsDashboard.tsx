/**
 * AnalyticsDashboard - Usage analytics with token/cost charts, project breakdown,
 * model usage, and session timeline.
 */

import React from 'react';

import { Skeleton } from '@renderer/components/ui/skeleton';
import { useAnalyticsData } from '@renderer/hooks/useAnalyticsData';
import { cn } from '@renderer/lib/utils';
import { formatTokensCompact } from '@shared/utils/tokenFormatting';
import { Activity, Clock, Cpu, DollarSign, TrendingUp, Zap } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { SessionSchedule } from './SessionSchedule';

import type { TimeRange } from '@renderer/hooks/useAnalyticsData';

// =============================================================================
// Stat Card
// =============================================================================

interface StatCardProps {
  label: string;
  value: string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  accentColor?: string;
}

const StatCard = ({
  label,
  value,
  subtitle,
  icon: Icon,
  accentColor = '#6366f1',
}: Readonly<StatCardProps>): React.JSX.Element => (
  <div className="group border-border bg-background/50 hover:bg-card relative flex flex-col gap-2 rounded-xs border p-4 transition-colors">
    <div className="flex items-center justify-between">
      <span className="text-text-muted text-[10px] font-medium tracking-wider uppercase">
        {label}
      </span>
      <div
        className="border-border flex size-7 items-center justify-center rounded-xs border"
        style={{ backgroundColor: accentColor + '10', color: accentColor }}
      >
        <Icon className="size-3.5" />
      </div>
    </div>
    <span className="text-text text-xl font-semibold">{value}</span>
    {subtitle && <span className="text-text-muted text-[10px]">{subtitle}</span>}
  </div>
);

// =============================================================================
// Chart Section Wrapper
// =============================================================================

interface ChartSectionProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}

const ChartSection = ({
  title,
  subtitle,
  children,
  className,
}: Readonly<ChartSectionProps>): React.JSX.Element => (
  <div className={cn('rounded-xs border border-border bg-background/50 p-4', className)}>
    <div className="mb-4">
      <h3 className="text-text text-sm font-medium">{title}</h3>
      {subtitle && <p className="text-text-muted mt-0.5 text-[10px]">{subtitle}</p>}
    </div>
    {children}
  </div>
);

// =============================================================================
// Custom Tooltips
// =============================================================================

interface TooltipPayloadItem {
  name: string;
  value: number;
  color: string;
  dataKey: string;
}

const CustomBarTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}): React.JSX.Element | null => {
  if (!active || !payload?.length) return null;

  return (
    <div className="border-border bg-surface-overlay rounded-xs border px-3 py-2 shadow-lg">
      <p className="text-text mb-1.5 text-xs font-medium">{label}</p>
      {payload.map((item, i) => (
        <div key={i} className="flex items-center gap-2 text-[10px]">
          <span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />
          <span className="text-text-secondary">{item.name}:</span>
          <span className="text-text font-medium">
            {item.dataKey === 'costUsd'
              ? `$${item.value.toFixed(4)}`
              : formatTokensCompact(item.value)}
          </span>
        </div>
      ))}
    </div>
  );
};

const CustomPieTooltip = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: {
    name: string;
    value: number;
    payload: { color: string; costUsd: number; sessionCount: number };
  }[];
}): React.JSX.Element | null => {
  if (!active || !payload?.length) return null;

  const data = payload[0];
  return (
    <div className="border-border bg-surface-overlay rounded-xs border px-3 py-2 shadow-lg">
      <p className="text-text mb-1 text-xs font-medium">{data.name}</p>
      <div className="space-y-0.5 text-[10px]">
        <p className="text-text-secondary">
          Tokens: <span className="text-text font-medium">{formatTokensCompact(data.value)}</span>
        </p>
        <p className="text-text-secondary">
          Cost: <span className="text-text font-medium">${data.payload.costUsd.toFixed(2)}</span>
        </p>
        <p className="text-text-secondary">
          Sessions: <span className="text-text font-medium">{data.payload.sessionCount}</span>
        </p>
      </div>
    </div>
  );
};

// =============================================================================
// Time Range Selector
// =============================================================================

const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: '7 days' },
  { value: 'month', label: '30 days' },
  { value: '3months', label: '90 days' },
];

const TimeRangeSelector = ({
  value,
  onChange,
}: {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}): React.JSX.Element => (
  <div className="border-border bg-surface-raised flex items-center gap-1 rounded-xs border p-0.5">
    {TIME_RANGES.map((range) => (
      <button
        key={range.value}
        onClick={() => onChange(range.value)}
        className={cn(
          'rounded-xs px-2.5 py-1 text-[10px] font-medium transition-all',
          value === range.value
            ? 'bg-indigo-500/10 text-indigo-400'
            : 'text-text-muted hover:text-text-secondary'
        )}
      >
        {range.label}
      </button>
    ))}
  </div>
);

// =============================================================================
// Top Sessions Table
// =============================================================================

import type { TopSessionEntry } from '@shared/types';

interface TopSessionsProps {
  sessions: TopSessionEntry[];
}

const TopSessions = ({ sessions }: Readonly<TopSessionsProps>): React.JSX.Element => (
  <div className="space-y-1.5">
    {sessions.length === 0 && (
      <p className="text-text-muted py-4 text-center text-xs">No sessions in this period</p>
    )}
    {sessions.map((s, i) => (
      <div
        key={i}
        className="border-border/50 hover:bg-surface-raised flex items-center gap-3 rounded-xs border px-3 py-2 transition-colors"
      >
        <span className="text-text-muted w-5 text-center text-[10px] font-medium">{i + 1}</span>
        <div className="min-w-0 flex-1">
          <p className="text-text truncate text-xs font-medium">{s.title}</p>
          <p className="text-text-muted text-[10px]">
            {s.projectName}
            {s.model && <span className="ml-1 opacity-60">({s.model})</span>}
          </p>
        </div>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="text-text-secondary">{formatTokensCompact(s.totalTokens)} tokens</span>
          <span className="text-text-muted">${s.costUsd.toFixed(3)}</span>
          <span className="text-text-muted">{formatDuration(s.durationMs)}</span>
        </div>
      </div>
    ))}
  </div>
);

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m`;
  const h = Math.floor(ms / 3600_000);
  const m = Math.round((ms % 3600_000) / 60_000);
  return `${h}h ${m}m`;
}

function formatCost(usd: number): string {
  if (usd >= 100) return `$${usd.toFixed(0)}`;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}

// =============================================================================
// Loading Skeleton
// =============================================================================

const DashboardSkeleton = (): React.JSX.Element => (
  <div className="space-y-6">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="border-border h-24 rounded-xs border" />
      ))}
    </div>
    <Skeleton className="border-border h-72 rounded-xs border" />
    <div className="grid gap-3 lg:grid-cols-2">
      <Skeleton className="border-border h-72 rounded-xs border" />
      <Skeleton className="border-border h-72 rounded-xs border" />
    </div>
  </div>
);

// =============================================================================
// Main Component
// =============================================================================

export const AnalyticsDashboard = (): React.JSX.Element => {
  const {
    timeBuckets,
    projectUsage,
    modelUsage,
    scheduleEvents,
    topSessions,
    totalTokens,
    totalCost,
    totalSessions,
    avgTokensPerSession,
    avgCostPerSession,
    loading,
    error,
    timeRange,
    setTimeRange,
  } = useAnalyticsData();

  const isHourly = timeRange === 'today';

  // Peak bucket
  const peakBucket =
    timeBuckets.length > 0
      ? timeBuckets.reduce((max, d) => (d.totalTokens > max.totalTokens ? d : max), timeBuckets[0])
      : null;

  // Active buckets count
  const activeBuckets = timeBuckets.filter((d) => d.sessionCount > 0).length;

  // XAxis tick interval based on range
  const xAxisInterval = isHourly ? 2 : timeRange === '3months' ? 6 : timeRange === 'month' ? 2 : 0;

  if (loading) {
    return (
      <div className="bg-background relative flex-1 overflow-auto">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[600px] bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.08),transparent)]"
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-6xl px-8 py-12">
          <div className="mb-8">
            <h1 className="text-text text-lg font-semibold">Analytics</h1>
            <p className="text-text-muted mt-1 text-xs">Loading usage data...</p>
          </div>
          <DashboardSkeleton />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-background relative flex-1 overflow-auto">
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <p className="text-text-secondary text-sm">Failed to load analytics</p>
            <p className="text-text-muted mt-1 text-xs">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background relative flex-1 overflow-auto">
      {/* Spotlight gradient */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[600px] bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.08),transparent)]"
        aria-hidden="true"
      />

      <div className="relative mx-auto max-w-6xl px-8 py-12">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-text text-lg font-semibold">Analytics</h1>
            <p className="text-text-muted mt-1 text-xs">
              Token usage, costs, and session activity across all projects
            </p>
          </div>
          <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
        </div>

        {/* Summary Stats */}
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard
            label="Total Tokens"
            value={formatTokensCompact(totalTokens)}
            subtitle={
              isHourly
                ? `${activeBuckets} active hour${activeBuckets !== 1 ? 's' : ''}`
                : `${activeBuckets} active day${activeBuckets !== 1 ? 's' : ''}`
            }
            icon={Zap}
            accentColor="#6366f1"
          />
          <StatCard
            label="Total Cost"
            value={formatCost(totalCost)}
            subtitle={`Avg ${formatCost(avgCostPerSession)}/session`}
            icon={DollarSign}
            accentColor="#10b981"
          />
          <StatCard
            label="Sessions"
            value={totalSessions.toString()}
            subtitle={`${projectUsage.length} project${projectUsage.length !== 1 ? 's' : ''}`}
            icon={Activity}
            accentColor="#8b5cf6"
          />
          <StatCard
            label="Avg Tokens/Session"
            value={formatTokensCompact(avgTokensPerSession)}
            icon={TrendingUp}
            accentColor="#f59e0b"
          />
          <StatCard
            label={isHourly ? 'Peak Hour' : 'Peak Day'}
            value={peakBucket ? formatTokensCompact(peakBucket.totalTokens) : '-'}
            subtitle={peakBucket?.label}
            icon={Clock}
            accentColor="#ec4899"
          />
        </div>

        {/* Token Usage Over Time */}
        <ChartSection
          title={isHourly ? 'Token Usage by Hour' : 'Token Usage Over Time'}
          subtitle={
            isHourly
              ? 'Hourly breakdown of input, output, and cache tokens'
              : 'Daily breakdown of input, output, and cache tokens'
          }
          className="mb-6"
        >
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={timeBuckets} barCategoryGap="15%">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: '#71717a' }}
                axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                tickLine={false}
                interval={xAxisInterval}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#71717a' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => formatTokensCompact(v)}
              />
              <Tooltip content={<CustomBarTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 10 }}
                iconSize={8}
                formatter={(value: string) => <span className="text-text-secondary">{value}</span>}
              />
              <Bar
                dataKey="inputTokens"
                name="Input"
                stackId="tokens"
                fill="#6366f1"
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="outputTokens"
                name="Output"
                stackId="tokens"
                fill="#8b5cf6"
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="cacheReadTokens"
                name="Cache Read"
                stackId="tokens"
                fill="#a78bfa"
                radius={[2, 2, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartSection>

        {/* Cost Over Time */}
        <ChartSection
          title={isHourly ? 'Hourly Cost' : 'Daily Cost'}
          subtitle={isHourly ? 'Estimated cost in USD per hour' : 'Estimated cost in USD per day'}
          className="mb-6"
        >
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={timeBuckets} barCategoryGap="15%">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: '#71717a' }}
                axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                tickLine={false}
                interval={xAxisInterval}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#71717a' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `$${v.toFixed(2)}`}
              />
              <Tooltip content={<CustomBarTooltip />} />
              <Bar dataKey="costUsd" name="Cost" fill="#10b981" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartSection>

        {/* Three-column: Project pie + Model pie + Top Sessions */}
        <div className="mb-6 grid gap-6 lg:grid-cols-3">
          {/* Project Token Distribution */}
          <ChartSection title="By Project" subtitle="Token distribution across projects">
            {projectUsage.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <p className="text-text-muted text-xs">No project data</p>
              </div>
            ) : (
              <div>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={projectUsage}
                      dataKey="totalTokens"
                      nameKey="projectName"
                      cx="50%"
                      cy="50%"
                      innerRadius={35}
                      outerRadius={70}
                      strokeWidth={1}
                      stroke="rgba(0,0,0,0.3)"
                    >
                      {projectUsage.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomPieTooltip />} />
                  </PieChart>
                </ResponsiveContainer>

                <div className="mt-2 space-y-1">
                  {projectUsage.slice(0, 6).map((proj) => (
                    <div key={proj.projectName} className="flex items-center gap-2">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: proj.color }}
                      />
                      <span className="text-text min-w-0 flex-1 truncate text-[10px]">
                        {proj.projectName}
                      </span>
                      <span className="text-text-muted shrink-0 text-[9px]">
                        {formatTokensCompact(proj.totalTokens)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </ChartSection>

          {/* Model Usage Distribution */}
          <ChartSection title="By Model" subtitle="Token distribution across models">
            {modelUsage.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <div
                    className="border-border mx-auto mb-2 flex size-8 items-center justify-center rounded-xs border"
                    style={{ backgroundColor: '#f59e0b10', color: '#f59e0b' }}
                  >
                    <Cpu className="size-4" />
                  </div>
                  <p className="text-text-muted text-xs">No model data</p>
                </div>
              </div>
            ) : (
              <div>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={modelUsage}
                      dataKey="totalTokens"
                      nameKey="displayName"
                      cx="50%"
                      cy="50%"
                      innerRadius={35}
                      outerRadius={70}
                      strokeWidth={1}
                      stroke="rgba(0,0,0,0.3)"
                    >
                      {modelUsage.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomPieTooltip />} />
                  </PieChart>
                </ResponsiveContainer>

                <div className="mt-2 space-y-1">
                  {modelUsage.map((m) => (
                    <div key={m.model} className="flex items-center gap-2">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: m.color }}
                      />
                      <span className="text-text min-w-0 flex-1 truncate text-[10px]">
                        {m.displayName}
                      </span>
                      <span className="text-text-muted shrink-0 text-[9px]">
                        {formatTokensCompact(m.totalTokens)} &middot; {formatCost(m.costUsd)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </ChartSection>

          {/* Top Sessions */}
          <ChartSection title="Top Sessions" subtitle="Most token-intensive sessions">
            <TopSessions sessions={topSessions} />
          </ChartSection>
        </div>

        {/* Session Schedule / Timeline */}
        <ChartSection
          title="Session Activity Timeline"
          subtitle={
            timeRange === 'today'
              ? "Today's session activity"
              : timeRange === 'week'
                ? 'Week view of session activity'
                : 'Monthly calendar view of session activity'
          }
          className="mb-6"
        >
          <SessionSchedule events={scheduleEvents} timeRange={timeRange} />
        </ChartSection>
      </div>
    </div>
  );
};
