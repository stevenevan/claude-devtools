/**
 * AnalyticsDashboard - Usage analytics with token/cost charts, project breakdown,
 * model usage, and session timeline.
 *
 * Display helpers (StatCard, ChartSection, custom tooltips, DayRangeSelector,
 * TopSessions, DashboardSkeleton, formatters) live in
 * `analyticsDashboardHelpers.tsx` so this file stays focused on data wiring +
 * layout.
 */

import React, { useState } from 'react';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@renderer/components/ui/collapsible';
import { useAnalyticsData } from '@renderer/hooks/useAnalyticsData';
import { cn } from '@renderer/lib/utils';
import { formatTokensCompact } from '@shared/utils/tokenFormatting';
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Clock,
  Cpu,
  DollarSign,
  TrendingUp,
  Wrench,
  Zap,
} from 'lucide-react';
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

import {
  ChartSection,
  CustomBarTooltip,
  CustomPieTooltip,
  DashboardSkeleton,
  DayRangeSelector,
  StatCard,
  TopSessions,
} from './analyticsDashboardHelpers';
import { BudgetPanel } from './BudgetPanel';
import { CostTrendChart } from './CostTrendChart';
import { DashboardCustomizeMenu } from './DashboardCustomizeMenu';
import { formatCost } from './dashboardFormatters';
import { DurationPanel } from './DurationPanel';
import { ErrorHotspotsPanel } from './ErrorHotspotsPanel';
import { ModelComparisonPanel } from './ModelComparisonPanel';
import { ProductivityPanel } from './ProductivityPanel';
import { SessionSchedule } from './SessionSchedule';
import { SnapshotsView } from './SnapshotsView';
import { ToolAnalyticsPanel } from './ToolAnalyticsPanel';
import { useWidgetVisible } from './useWidgetVisibility';

export const AnalyticsDashboard = (): React.JSX.Element => {
  const showBudget = useWidgetVisible('budget-panel');
  const showProductivity = useWidgetVisible('productivity-panel');
  const showDuration = useWidgetVisible('duration-panel');
  const showModelComparison = useWidgetVisible('model-comparison');
  const showSnapshots = useWidgetVisible('snapshots-view');
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
    granularity,
    loading,
    error,
    days,
    setDays,
  } = useAnalyticsData();
  const [toolAnalyticsOpen, setToolAnalyticsOpen] = useState(false);

  const peakBucket =
    timeBuckets.length > 0
      ? timeBuckets.reduce((max, d) => (d.totalTokens > max.totalTokens ? d : max), timeBuckets[0])
      : null;

  const activeBuckets = timeBuckets.filter((d) => d.sessionCount > 0).length;

  const bucketNoun =
    granularity === 'hourly'
      ? 'hour'
      : granularity === 'weekly'
        ? 'week'
        : granularity === 'monthly'
          ? 'month'
          : 'day';
  const peakLabel = `Peak ${bucketNoun.charAt(0).toUpperCase() + bucketNoun.slice(1)}`;

  const xAxisInterval = timeBuckets.length > 30 ? 6 : timeBuckets.length > 14 ? 2 : 0;

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
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[600px] bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.08),transparent)]"
        aria-hidden="true"
      />

      <div className="relative mx-auto max-w-6xl px-8 py-12">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-text text-lg font-semibold">Analytics</h1>
            <p className="text-text-muted mt-1 text-xs">
              Token usage, costs, and session activity across all projects
            </p>
          </div>
          <div className="flex items-center gap-2">
            <DashboardCustomizeMenu />
            <DayRangeSelector value={days} onChange={setDays} />
          </div>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard
            label="Total Tokens"
            value={formatTokensCompact(totalTokens)}
            subtitle={`${activeBuckets} active ${bucketNoun}${activeBuckets !== 1 ? 's' : ''}`}
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
            label={peakLabel}
            value={peakBucket ? formatTokensCompact(peakBucket.totalTokens) : '-'}
            subtitle={peakBucket?.label}
            icon={Clock}
            accentColor="#ec4899"
          />
        </div>

        <ChartSection
          title="Token Usage Over Time"
          subtitle={`Per-${bucketNoun} breakdown of input, output, and cache tokens`}
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
              <Bar dataKey="inputTokens" name="Input" stackId="tokens" fill="#6366f1" />
              <Bar dataKey="outputTokens" name="Output" stackId="tokens" fill="#8b5cf6" />
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

        {showBudget && (
          <div className="mb-6">
            <BudgetPanel />
          </div>
        )}
        {showProductivity && (
          <div className="mb-6">
            <ProductivityPanel />
          </div>
        )}
        {showDuration && (
          <div className="mb-6">
            <DurationPanel />
          </div>
        )}
        {showModelComparison && (
          <div className="mb-6">
            <ModelComparisonPanel />
          </div>
        )}
        {showSnapshots && (
          <div className="mb-6">
            <SnapshotsView />
          </div>
        )}

        <ChartSection
          title="Cost Trend"
          subtitle="Week-over-week spend with per-period breakdown"
          className="mb-6"
        >
          <CostTrendChart buckets={timeBuckets} bucketNoun={bucketNoun} />
        </ChartSection>

        <div className="mb-6 grid gap-6 lg:grid-cols-3">
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

          <ChartSection title="Top Sessions" subtitle="Most token-intensive sessions">
            <TopSessions sessions={topSessions} />
          </ChartSection>
        </div>

        <Collapsible open={toolAnalyticsOpen} onOpenChange={setToolAnalyticsOpen} className="mb-6">
          <CollapsibleTrigger
            className={cn(
              'flex w-full items-center justify-between rounded-xs border border-border bg-background/50 px-4 py-3 text-left transition-colors hover:bg-card'
            )}
          >
            <div className="flex items-center gap-2">
              <Wrench className="text-text-muted size-4" />
              <div>
                <h3 className="text-text text-sm font-medium">Tool Usage Analytics</h3>
                <p className="text-text-muted mt-0.5 text-[10px]">
                  Per-tool call count, error rate, duration, median token cost
                </p>
              </div>
            </div>
            {toolAnalyticsOpen ? (
              <ChevronDown className="text-text-muted size-4" />
            ) : (
              <ChevronRight className="text-text-muted size-4" />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <ToolAnalyticsPanel days={days} />
          </CollapsibleContent>
        </Collapsible>

        <div className="mb-6">
          <ErrorHotspotsPanel days={days} />
        </div>

        <ChartSection
          title="Session Activity Timeline"
          subtitle={
            days <= 1
              ? "Today's session activity"
              : days <= 14
                ? 'Day view of session activity'
                : 'Monthly calendar view of session activity'
          }
          className="mb-6"
        >
          <SessionSchedule events={scheduleEvents} days={days} />
        </ChartSection>
      </div>
    </div>
  );
};
