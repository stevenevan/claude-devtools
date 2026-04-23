import React, { useEffect, useState } from 'react';

import { ToolTimeHeatmap } from '@renderer/components/dashboard/ToolTimeHeatmap';
import { useToolAnalyticsData } from '@renderer/hooks/useToolAnalyticsData';
import { useStore } from '@renderer/store';
import { cn } from '@renderer/lib/utils';
import { NativeSelect, NativeSelectOption } from '@renderer/components/ui/native-select';
import { formatTokensCompact } from '@shared/utils/tokenFormatting';
import { ChevronRight } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const TOP_N = 10;

const TOOL_COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#f59e0b',
  '#10b981',
  '#06b6d4',
  '#f97316',
  '#84cc16',
  '#ef4444',
  '#3b82f6',
];

function formatDuration(ms: number): string {
  if (!ms) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(0)}%`;
}

interface ToolAnalyticsPanelProps {
  days: number;
}

export const ToolAnalyticsPanel = ({
  days,
}: Readonly<ToolAnalyticsPanelProps>): React.JSX.Element => {
  const projects = useStore((s) => s.projects);
  const selectedProjectId = useStore((s) => s.selectedProjectId);
  const [projectId, setProjectId] = useState<string | null>(selectedProjectId ?? null);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  useEffect(() => {
    if (projectId) return;
    if (selectedProjectId) {
      setProjectId(selectedProjectId);
      return;
    }
    if (projects.length > 0) {
      setProjectId(projects[0].id);
    }
  }, [projectId, selectedProjectId, projects]);

  const { tools, totalCalls, totalErrors, scannedSessions, loading, error } =
    useToolAnalyticsData(projectId, days);

  const topTools = tools.slice(0, TOP_N).map((t, i) => ({
    ...t,
    color: TOOL_COLORS[i % TOOL_COLORS.length],
  }));

  const selectedProject = projects.find((p) => p.id === projectId);

  return (
    <div className="rounded-xs border border-border bg-background/50 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-text text-sm font-medium">Tool Usage</h3>
          <p className="text-text-muted mt-0.5 text-[10px]">
            {selectedProject
              ? `Per-tool call stats for ${selectedProject.name}`
              : 'Select a project to view tool usage'}
            {scannedSessions > 0 && ` · ${scannedSessions} session${scannedSessions === 1 ? '' : 's'} scanned`}
          </p>
        </div>
        <NativeSelect
          size="sm"
          value={projectId ?? ''}
          onChange={(e) => {
            setProjectId(e.target.value || null);
            setExpandedTool(null);
          }}
          disabled={projects.length === 0}
        >
          <NativeSelectOption value="" disabled>
            Select project
          </NativeSelectOption>
          {projects.map((p) => (
            <NativeSelectOption key={p.id} value={p.id}>
              {p.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      {error && (
        <p className="text-text-muted py-4 text-center text-xs">Failed to load tool analytics: {error}</p>
      )}
      {!error && loading && (
        <p className="text-text-muted py-4 text-center text-xs">Loading tool analytics...</p>
      )}
      {!error && !loading && tools.length === 0 && projectId && (
        <p className="text-text-muted py-4 text-center text-xs">No tool calls in this range</p>
      )}

      {!error && !loading && topTools.length > 0 && (
        <>
          <div className="mb-3 grid grid-cols-3 gap-2 text-[10px]">
            <div className="border-border/50 rounded-xs border px-2 py-1.5">
              <span className="text-text-muted block">Total calls</span>
              <span className="text-text font-mono text-xs">{totalCalls}</span>
            </div>
            <div className="border-border/50 rounded-xs border px-2 py-1.5">
              <span className="text-text-muted block">Errors</span>
              <span className={cn('font-mono text-xs', totalErrors > 0 ? 'text-red-400' : 'text-text')}>
                {totalErrors}
              </span>
            </div>
            <div className="border-border/50 rounded-xs border px-2 py-1.5">
              <span className="text-text-muted block">Error rate</span>
              <span className="text-text font-mono text-xs">
                {totalCalls > 0 ? formatPercent(totalErrors / totalCalls) : '—'}
              </span>
            </div>
          </div>

          <div className="mb-4">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={topTools} layout="vertical" barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: '#71717a' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="toolName"
                  tick={{ fontSize: 10, fill: '#71717a' }}
                  axisLine={false}
                  tickLine={false}
                  width={96}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                  contentStyle={{
                    backgroundColor: 'var(--color-surface-overlay)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 2,
                    fontSize: 10,
                  }}
                />
                <Bar dataKey="callCount" name="Calls" radius={[0, 2, 2, 0]}>
                  {topTools.map((t) => (
                    <Cell key={t.toolName} fill={t.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="overflow-hidden rounded-xs border border-border/50">
            <table className="w-full text-[10px]">
              <thead className="bg-surface-raised">
                <tr className="text-text-muted">
                  <th className="w-6" />
                  <th className="px-2 py-1.5 text-left font-medium">Tool</th>
                  <th className="px-2 py-1.5 text-right font-medium">Calls</th>
                  <th className="px-2 py-1.5 text-right font-medium">Error rate</th>
                  <th className="px-2 py-1.5 text-right font-medium">Avg duration</th>
                  <th className="px-2 py-1.5 text-right font-medium">Median tokens</th>
                </tr>
              </thead>
              <tbody>
                {tools.map((t) => {
                  const isExpanded = expandedTool === t.toolName;
                  return (
                    <React.Fragment key={t.toolName}>
                      <tr
                        onClick={() => setExpandedTool(isExpanded ? null : t.toolName)}
                        className={cn(
                          'border-t border-border/30 cursor-pointer hover:bg-surface-raised',
                          isExpanded && 'bg-surface-raised'
                        )}
                      >
                        <td className="px-1.5 py-1.5">
                          <ChevronRight
                            className={cn('size-3 text-text-muted transition-transform', isExpanded && 'rotate-90')}
                          />
                        </td>
                        <td className="text-text px-2 py-1.5 font-medium">{t.toolName}</td>
                        <td className="text-text-secondary px-2 py-1.5 text-right font-mono">
                          {t.callCount}
                        </td>
                        <td
                          className={cn(
                            'px-2 py-1.5 text-right font-mono',
                            t.errorRate > 0.1 ? 'text-red-400' : 'text-text-secondary'
                          )}
                        >
                          {formatPercent(t.errorRate)}
                        </td>
                        <td className="text-text-secondary px-2 py-1.5 text-right font-mono">
                          {formatDuration(t.avgDurationMs)}
                        </td>
                        <td className="text-text-secondary px-2 py-1.5 text-right font-mono">
                          {formatTokensCompact(t.medianTokenCost)}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-surface-raised/60">
                          <td />
                          <td colSpan={5} className="px-2 py-2">
                            <div className="grid grid-cols-2 gap-3 text-[10px] sm:grid-cols-4">
                              <div>
                                <span className="text-text-muted block">Success</span>
                                <span className="text-text font-mono">{t.successCount}</span>
                              </div>
                              <div>
                                <span className="text-text-muted block">Errors</span>
                                <span className={cn('font-mono', t.errorCount > 0 ? 'text-red-400' : 'text-text')}>
                                  {t.errorCount}
                                </span>
                              </div>
                              <div>
                                <span className="text-text-muted block">Success rate</span>
                                <span className="text-text font-mono">{formatPercent(t.successRate)}</span>
                              </div>
                              <div>
                                <span className="text-text-muted block">Median token cost</span>
                                <span className="text-text font-mono">
                                  {formatTokensCompact(t.medianTokenCost)}
                                </span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <ToolTimeHeatmap projectId={projectId} days={days} />
    </div>
  );
};
