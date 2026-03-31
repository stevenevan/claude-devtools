/**
 * LiveMetricsBar — real-time metrics display for ongoing/streaming sessions.
 * Shows token count, cost, tool call count, and elapsed time.
 * Only visible when the session is actively streaming.
 */

import React, { useEffect, useState } from 'react';

import { cn } from '@renderer/lib/utils';
import { Activity, Clock, Coins, Zap } from 'lucide-react';

import type { SessionMetrics } from '@shared/types';

interface LiveMetricsBarProps {
  metrics: SessionMetrics | null | undefined;
  isStreaming: boolean;
  startTime?: number | null;
  className?: string;
}

function formatTokensCompact(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

function formatCost(cost: number | null | undefined): string {
  if (!cost || cost <= 0) return '$0.00';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function formatElapsed(startTime: number | null | undefined): string {
  if (!startTime) return '0s';
  const start = startTime;
  const now = Date.now();
  const diffMs = Math.max(0, now - start);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export const LiveMetricsBar = ({
  metrics,
  isStreaming,
  startTime,
  className,
}: Readonly<LiveMetricsBarProps>): React.JSX.Element | null => {
  const [, setTick] = useState(0);

  // Update elapsed time every second while streaming
  useEffect(() => {
    if (!isStreaming) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [isStreaming]);

  if (!isStreaming || !metrics) return null;

  const totalTokens = metrics.totalTokens ?? 0;
  const toolCount = metrics.messageCount ?? 0;

  return (
    <div
      className={cn(
        'border-border/50 bg-surface-raised/80 flex items-center gap-4 border-b px-4 py-1.5 text-xs backdrop-blur-sm',
        className
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex size-full rounded-full bg-green-500" />
        </span>
        <span className="text-text-secondary font-medium">Streaming</span>
      </div>

      <div className="bg-border/50 h-3 w-px" />

      <div className="text-text-muted flex items-center gap-1">
        <Zap className="size-3" />
        <span>{formatTokensCompact(totalTokens)} tokens</span>
      </div>

      <div className="text-text-muted flex items-center gap-1">
        <Coins className="size-3" />
        <span>{formatCost(metrics.costUsd)}</span>
      </div>

      <div className="text-text-muted flex items-center gap-1">
        <Activity className="size-3" />
        <span>{toolCount} msgs</span>
      </div>

      <div className="text-text-muted flex items-center gap-1">
        <Clock className="size-3" />
        <span>{formatElapsed(startTime)}</span>
      </div>
    </div>
  );
};
