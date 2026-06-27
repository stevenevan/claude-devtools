

import { JSX, useState } from 'react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@renderer/components/ui/collapsible';
import { useAnalyticsData } from '@renderer/hooks/useAnalyticsData';
import { cn } from '@renderer/lib/utils';
import { ChevronDown, ChevronRight, Wrench } from 'lucide-react';

import { ChartSection, DashboardSkeleton, DayRangeSelector } from '../analyticsDashboardHelpers';
import { BudgetPanel } from '../BudgetPanel';
import { CostTrendChart } from '../CostTrendChart';
import { DashboardCustomizeMenu } from '../DashboardCustomizeMenu';
import { DurationPanel } from '../DurationPanel';
import { ErrorHotspotsPanel } from '../ErrorHotspotsPanel';
import { ModelComparisonPanel } from '../ModelComparisonPanel';
import { ProductivityPanel } from '../ProductivityPanel';
import { SessionSchedule } from '../SessionSchedule';
import { SnapshotsView } from '../SnapshotsView';
import { ToolAnalyticsPanel } from '../ToolAnalyticsPanel';
import { useWidgetVisible } from '../useWidgetVisibility';
import { DistributionCharts } from './DistributionCharts';
import { StatCardsRow } from './StatCardsRow';
import { TokenUsageBarChart } from './TokenUsageBarChart';

export const AnalyticsDashboard = (): JSX.Element => {
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

        <StatCardsRow
          totalTokens={totalTokens}
          totalCost={totalCost}
          totalSessions={totalSessions}
          avgTokensPerSession={avgTokensPerSession}
          avgCostPerSession={avgCostPerSession}
          peakBucket={peakBucket}
          peakLabel={peakLabel}
          activeBuckets={activeBuckets}
          bucketNoun={bucketNoun}
          projectCount={projectUsage.length}
        />

        <TokenUsageBarChart
          timeBuckets={timeBuckets}
          bucketNoun={bucketNoun}
          xAxisInterval={xAxisInterval}
        />

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

        <DistributionCharts
          projectUsage={projectUsage}
          modelUsage={modelUsage}
          topSessions={topSessions}
        />

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
