import { type computeSubagentPhaseBreakdown } from '@renderer/utils/aiGroupHelpers';
import { formatTokensCompact } from '@renderer/utils/formatters';
import { ArrowUpRight, CircleDot, Sigma } from 'lucide-react';

import type { Process } from '@renderer/types/data';

interface ContextUsageRowsProps {
  subagent: Process;
  hasMainImpact: boolean | undefined;
  hasIsolated: boolean | null | undefined;
  cumulativeMetrics?: { outputTokens: number; turnCount: number };
  isMultiPhase: boolean;
  isolatedTotal: number;
  phaseData: ReturnType<typeof computeSubagentPhaseBreakdown>;
}

export const ContextUsageRows = ({
  subagent,
  hasMainImpact,
  hasIsolated,
  cumulativeMetrics,
  isMultiPhase,
  isolatedTotal,
  phaseData,
}: ContextUsageRowsProps): JSX.Element | null => {
  if (!(hasMainImpact ?? hasIsolated)) return null;

  return (
    <div className="pt-2">
      {/* Overline title */}
      <div className="text-muted-foreground mb-2 text-[10px] font-semibold tracking-wider uppercase">
        Context Usage
      </div>

      {/* Token rows - floating alignment */}
      <div className="space-y-1.5">
        {hasMainImpact && !subagent.team && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ArrowUpRight className="size-3 text-indigo-400" />
              <span className="text-muted-foreground text-xs">Main Context</span>
            </div>
            <span className="text-foreground font-mono text-xs font-medium tabular-nums">
              {subagent.mainSessionImpact!.totalTokens.toLocaleString()}
            </span>
          </div>
        )}

        {cumulativeMetrics && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sigma className="size-3 text-blue-400" />
              <span className="text-muted-foreground text-xs">Total Output</span>
            </div>
            <span className="text-foreground font-mono text-xs font-medium tabular-nums">
              {cumulativeMetrics.outputTokens.toLocaleString()}
              <span className="text-muted-foreground"> ({cumulativeMetrics.turnCount} turns)</span>
            </span>
          </div>
        )}

        {hasIsolated && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CircleDot className="size-3 text-green-400" />
              <span className="text-muted-foreground text-xs">
                {subagent.team ? 'Context Window' : 'Subagent Context'}
              </span>
            </div>
            <span className="text-foreground font-mono text-xs font-medium tabular-nums">
              {isolatedTotal.toLocaleString()}
            </span>
          </div>
        )}

        {/* Per-phase breakdown when multi-phase */}
        {isMultiPhase &&
          phaseData!.phases.map((phase) => (
            <div key={phase.phaseNumber} className="flex items-center justify-between pl-5">
              <span className="text-muted-foreground text-[11px]">Phase {phase.phaseNumber}</span>
              <span className="text-muted-foreground font-mono text-[11px] tabular-nums">
                {formatTokensCompact(phase.peakTokens)}
                {phase.postCompaction != null && (
                  <span className="text-green-400">
                    {' '}
                    → {formatTokensCompact(phase.postCompaction)}
                  </span>
                )}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
};
