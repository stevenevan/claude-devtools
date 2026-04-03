/**
 * SessionComparison - Side-by-side comparison of two sessions.
 * Shows metrics, tool usage, and conversation differences.
 */

import { useEffect, useState } from 'react';

import { api } from '@renderer/api';
import { cn } from '@renderer/lib/utils';
import { formatDuration, formatTokensCompact } from '@renderer/utils/formatters';
import { parseModelString } from '@shared/utils/modelParser';
import {
  ArrowLeftRight,
  Clock,
  DollarSign,
  Hash,
  Layers,
  Loader2,
  Wrench,
  Zap,
} from 'lucide-react';

import type { SessionDetail } from '@shared/types/chunks';
import type { Tab } from '@renderer/types/tabs';

interface SessionComparisonProps {
  tab: Tab;
}

interface MetricRowProps {
  icon: React.ElementType;
  label: string;
  leftValue: string;
  rightValue: string;
  iconColor?: string;
}

function formatCost(cost?: number): string {
  if (!cost) return '--';
  if (cost < 0.01) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

const MetricRow = ({ icon: Icon, label, leftValue, rightValue, iconColor = 'text-muted-foreground' }: Readonly<MetricRowProps>): React.JSX.Element => (
  <div className="flex items-center gap-3 py-1.5">
    <Icon className={cn('size-3.5 shrink-0', iconColor)} />
    <span className="text-muted-foreground w-24 shrink-0 text-xs">{label}</span>
    <span className="text-foreground flex-1 text-right text-xs tabular-nums">{leftValue}</span>
    <span className="text-foreground flex-1 text-right text-xs tabular-nums">{rightValue}</span>
  </div>
);

/** Count tool calls by name from session detail chunks. */
function countTools(detail: SessionDetail): Map<string, number> {
  const counts = new Map<string, number>();
  for (const chunk of detail.chunks) {
    if ('toolExecutions' in chunk) {
      for (const exec of (chunk as { toolExecutions: { toolCall: { name: string } }[] }).toolExecutions) {
        const name = exec.toolCall.name;
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
  }
  return counts;
}

export const SessionComparison = ({ tab }: Readonly<SessionComparisonProps>): React.JSX.Element => {
  const [leftDetail, setLeftDetail] = useState<SessionDetail | null>(null);
  const [rightDetail, setRightDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tab.projectId || !tab.sessionId || !tab.compareProjectId || !tab.compareSessionId) return;

    setLoading(true);
    void Promise.all([
      api.getSessionDetail(tab.projectId, tab.sessionId),
      api.getSessionDetail(tab.compareProjectId, tab.compareSessionId),
    ]).then(([left, right]) => {
      setLeftDetail(left);
      setRightDetail(right);
      setLoading(false);
    });
  }, [tab.projectId, tab.sessionId, tab.compareProjectId, tab.compareSessionId]);

  if (loading) {
    return (
      <div className="bg-background flex flex-1 items-center justify-center">
        <Loader2 className="text-muted-foreground size-6 animate-spin" />
      </div>
    );
  }

  if (!leftDetail || !rightDetail) {
    return (
      <div className="bg-background flex flex-1 items-center justify-center">
        <p className="text-muted-foreground text-sm">Failed to load session data for comparison</p>
      </div>
    );
  }

  const leftMetrics = leftDetail.metrics;
  const rightMetrics = rightDetail.metrics;
  const leftModel = leftMetrics.model ? parseModelString(leftMetrics.model)?.name ?? leftMetrics.model : '--';
  const rightModel = rightMetrics.model ? parseModelString(rightMetrics.model)?.name ?? rightMetrics.model : '--';

  const leftTools = countTools(leftDetail);
  const rightTools = countTools(rightDetail);
  const allToolNames = new Set([...leftTools.keys(), ...rightTools.keys()]);

  return (
    <div className="bg-background flex-1 overflow-auto">
      <div className="mx-auto max-w-3xl px-8 py-12">
        {/* Header */}
        <div className="mb-8 flex items-center gap-3">
          <ArrowLeftRight className="text-indigo-400" />
          <h1 className="text-foreground text-lg font-semibold">Session Comparison</h1>
        </div>

        {/* Session labels */}
        <div className="mb-4 flex items-center gap-3">
          <div className="w-24 shrink-0" />
          <div className="flex-1 text-right">
            <span className="text-foreground truncate text-xs font-medium">
              {leftDetail.session.customTitle ?? tab.sessionId?.slice(0, 8) ?? 'Session A'}
            </span>
          </div>
          <div className="flex-1 text-right">
            <span className="text-foreground truncate text-xs font-medium">
              {rightDetail.session.customTitle ?? tab.compareSessionId?.slice(0, 8) ?? 'Session B'}
            </span>
          </div>
        </div>

        {/* Metrics comparison */}
        <div className="border-border rounded-lg border p-4">
          <h2 className="text-muted-foreground mb-3 text-[10px] font-medium uppercase tracking-wider">
            Metrics
          </h2>
          <div className="divide-border divide-y">
            <MetricRow icon={Zap} label="Total Tokens" leftValue={formatTokensCompact(leftMetrics.totalTokens)} rightValue={formatTokensCompact(rightMetrics.totalTokens)} iconColor="text-amber-400/70" />
            <MetricRow icon={DollarSign} label="Cost" leftValue={formatCost(leftMetrics.costUsd)} rightValue={formatCost(rightMetrics.costUsd)} iconColor="text-green-400/70" />
            <MetricRow icon={Clock} label="Duration" leftValue={formatDuration(leftMetrics.durationMs)} rightValue={formatDuration(rightMetrics.durationMs)} iconColor="text-blue-400/70" />
            <MetricRow icon={Hash} label="Messages" leftValue={String(leftMetrics.messageCount)} rightValue={String(rightMetrics.messageCount)} iconColor="text-purple-400/70" />
            <MetricRow icon={Layers} label="Model" leftValue={leftModel} rightValue={rightModel} iconColor="text-indigo-400/70" />
          </div>
        </div>

        {/* Tool usage comparison */}
        {allToolNames.size > 0 && (
          <div className="border-border mt-6 rounded-lg border p-4">
            <h2 className="text-muted-foreground mb-3 text-[10px] font-medium uppercase tracking-wider">
              Tool Usage
            </h2>
            <div className="divide-border divide-y">
              {[...allToolNames].sort().map((toolName) => (
                <div key={toolName} className="flex items-center gap-3 py-1.5">
                  <Wrench className="text-muted-foreground size-3.5 shrink-0" />
                  <span className="text-muted-foreground w-24 shrink-0 truncate font-mono text-xs">{toolName}</span>
                  <span className="text-foreground flex-1 text-right text-xs tabular-nums">
                    {leftTools.get(toolName) ?? 0}
                  </span>
                  <span className="text-foreground flex-1 text-right text-xs tabular-nums">
                    {rightTools.get(toolName) ?? 0}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
