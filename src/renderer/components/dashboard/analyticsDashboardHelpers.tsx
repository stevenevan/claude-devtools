/**
 * Inline UI helpers extracted from AnalyticsDashboard to keep that
 * component focused on data wiring + layout.
 */
import React, { useState } from 'react';

import { Skeleton } from '@renderer/components/ui/skeleton';
import { MAX_DAYS } from '@renderer/hooks/useAnalyticsData';
import { cn } from '@renderer/lib/utils';
import { formatTokensCompact } from '@shared/utils/tokenFormatting';

import { formatDuration } from './dashboardFormatters';

import type { TopSessionEntry } from '@shared/types';

// StatCard

export interface StatCardProps {
  label: string;
  value: string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  accentColor?: string;
}

export const StatCard = ({
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
    <div className="flex-1">
      <p className="text-text text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {subtitle && <p className="text-text-muted mt-0.5 text-[10px]">{subtitle}</p>}
    </div>
  </div>
);

// ChartSection

export interface ChartSectionProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}

export const ChartSection = ({
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

// Chart Tooltips

interface TooltipPayloadItem {
  name: string;
  value: number;
  color: string;
  dataKey: string;
}

export const CustomBarTooltip = ({
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

export const CustomPieTooltip = ({
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

// Day Range Selector

const PRESET_RANGES = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7d' },
  { days: 14, label: '14d' },
  { days: 30, label: '30d' },
  { days: 60, label: '60d' },
  { days: 90, label: '90d' },
];

export const DayRangeSelector = ({
  value,
  onChange,
}: {
  value: number;
  onChange: (days: number) => void;
}): React.JSX.Element => {
  const [customInput, setCustomInput] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const isPreset = PRESET_RANGES.some((r) => r.days === value);

  const applyCustom = (): void => {
    const parsed = parseInt(customInput, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= MAX_DAYS) {
      onChange(parsed);
      setShowCustom(false);
      setCustomInput('');
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <div className="border-border bg-surface-raised flex items-center gap-0.5 rounded-xs border p-0.5">
        {PRESET_RANGES.map((range) => (
          <button
            key={range.days}
            onClick={() => {
              onChange(range.days);
              setShowCustom(false);
            }}
            className={cn(
              'rounded-xs px-2 py-1 text-[10px] font-medium transition-all',
              value === range.days && !showCustom
                ? 'bg-indigo-500/10 text-indigo-400'
                : 'text-text-muted hover:text-text-secondary'
            )}
          >
            {range.label}
          </button>
        ))}
        <button
          onClick={() => setShowCustom(!showCustom)}
          className={cn(
            'rounded-xs px-2 py-1 text-[10px] font-medium transition-all',
            showCustom || !isPreset
              ? 'bg-indigo-500/10 text-indigo-400'
              : 'text-text-muted hover:text-text-secondary'
          )}
        >
          {!isPreset ? `${value}d` : 'Custom'}
        </button>
      </div>

      {showCustom && (
        <div className="border-border bg-surface-raised flex items-center gap-1 rounded-xs border px-2 py-0.5">
          <input
            type="number"
            min={1}
            max={MAX_DAYS}
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyCustom()}
            placeholder="1-90"
            className="text-text placeholder:text-text-muted w-12 bg-transparent text-center text-[10px] outline-hidden"
            autoFocus
          />
          <span className="text-text-muted text-[10px]">days</span>
        </div>
      )}
    </div>
  );
};

// Top Sessions Table

export interface TopSessionsProps {
  sessions: TopSessionEntry[];
}

export const TopSessions = ({ sessions }: Readonly<TopSessionsProps>): React.JSX.Element => (
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

// Loading Skeleton

export const DashboardSkeleton = (): React.JSX.Element => (
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
