import React from 'react';

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@renderer/components/ui/hover-card';
import { formatTokensCompact } from '@renderer/utils/formatters';

import type { PhaseTokenBreakdown } from '@renderer/types/data';

interface MetricsPillProps {
  mainSessionImpact?: {
    callTokens: number;
    resultTokens: number;
    totalTokens: number;
  };
  lastUsage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  /** Label override for the right segment (e.g. "Context Window" for team members) */
  isolatedLabel?: string;
  /** Override isolated total (for multi-phase total consumption) */
  isolatedOverride?: number;
  /** Phase breakdown for tooltip (shown when multiple phases exist) */
  phaseBreakdown?: PhaseTokenBreakdown[];
}

export const MetricsPill = ({
  mainSessionImpact,
  lastUsage,
  isolatedLabel,
  isolatedOverride,
  phaseBreakdown,
}: Readonly<MetricsPillProps>): React.ReactElement | null => {
  const hasMainImpact = mainSessionImpact && mainSessionImpact.totalTokens > 0;
  const hasIsolated =
    isolatedOverride != null
      ? isolatedOverride > 0
      : lastUsage && lastUsage.input_tokens + lastUsage.output_tokens > 0;

  const isolatedTotal =
    isolatedOverride ??
    (lastUsage
      ? lastUsage.input_tokens +
        lastUsage.output_tokens +
        (lastUsage.cache_read_input_tokens ?? 0) +
        (lastUsage.cache_creation_input_tokens ?? 0)
      : 0);

  const hasPhases = phaseBreakdown && phaseBreakdown.length > 1;

  if (!hasMainImpact && !hasIsolated) {
    return null;
  }

  const mainValue = hasMainImpact ? formatTokensCompact(mainSessionImpact.totalTokens) : null;
  const isolatedValue = hasIsolated ? formatTokensCompact(isolatedTotal) : null;
  const rightLabel = isolatedLabel ?? 'Subagent Context';

  return (
    <HoverCard>
      <HoverCardTrigger
        className="inline-flex cursor-default items-center gap-1 rounded-sm border border-[var(--tag-border)] bg-[var(--tag-bg)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--tag-text)]"
        render={<span />}
      >
        {mainValue && <span className="tabular-nums">{mainValue}</span>}
        {mainValue && isolatedValue && <span className="text-[var(--card-separator)]">|</span>}
        {isolatedValue && <span className="tabular-nums">{isolatedValue}</span>}
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        sideOffset={6}
        className="w-[220px] bg-surface-overlay border-[var(--tag-border)] p-2 text-[11px] shadow-xl [backdrop-filter:blur(8px)]"
      >
        <div className="space-y-1">
          {hasMainImpact && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-text-muted">Main Context</span>
              <span className="font-mono text-[var(--card-text-light)] tabular-nums">
                {mainSessionImpact.totalTokens.toLocaleString()}
              </span>
            </div>
          )}
          {hasIsolated && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-text-muted">{rightLabel}</span>
              <span className="font-mono text-[var(--card-text-light)] tabular-nums">
                {isolatedTotal.toLocaleString()}
              </span>
            </div>
          )}
          {hasPhases &&
            phaseBreakdown.map((phase) => (
              <div
                key={phase.phaseNumber}
                className="flex items-center justify-between gap-3 pl-2"
              >
                <span className="text-[10px] text-[var(--card-icon-muted)]">
                  Phase {phase.phaseNumber}
                </span>
                <span className="font-mono text-[10px] text-[var(--card-icon-muted)] tabular-nums">
                  {formatTokensCompact(phase.peakTokens)}
                  {phase.postCompaction != null && (
                    <span className="text-[var(--metric-compaction-freed)]">
                      {' '}
                      → {formatTokensCompact(phase.postCompaction)}
                    </span>
                  )}
                </span>
              </div>
            ))}
          <div className="mt-1 border-t border-[var(--tag-border)] pt-1.5 text-[10px] text-[var(--card-icon-muted)]">
            {hasMainImpact && hasIsolated
              ? 'Left: parent injection · Right: internal'
              : hasMainImpact
                ? 'Tokens injected to parent'
                : 'Internal token usage'}
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
};
