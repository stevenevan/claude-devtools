/**
 * SessionContextHeader - Header component with title, help tooltip, and token stats.
 */

import React from 'react';

import { cn } from '@renderer/lib/utils';
import { ArrowDownWideNarrow, FileText, LayoutList, X } from 'lucide-react';

import { formatTokens } from '../utils/formatting';

import { SessionContextHelpTooltip } from './SessionContextHelpTooltip';

import type { ContextViewMode } from '../types';
import type { ContextPhaseInfo } from '@renderer/types/contextInjection';

interface SessionContextHeaderProps {
  injectionCount: number;
  totalTokens: number;
  totalSessionTokens?: number;
  onClose?: () => void;
  phaseInfo?: ContextPhaseInfo;
  selectedPhase: number | null;
  onPhaseChange: (phase: number | null) => void;
  viewMode: ContextViewMode;
  onViewModeChange: (mode: ContextViewMode) => void;
}

export const SessionContextHeader = ({
  injectionCount,
  totalTokens,
  totalSessionTokens,
  onClose,
  phaseInfo,
  selectedPhase,
  onPhaseChange,
  viewMode,
  onViewModeChange,
}: Readonly<SessionContextHeaderProps>): React.ReactElement => {
  return (
    <div className="border-border shrink-0 border-b px-4 py-3">
      {/* Title row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Visible Context</h2>
          <span className="rounded-sm bg-popover px-1.5 py-0.5 text-xs text-muted-foreground">
            {injectionCount}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <SessionContextHelpTooltip />
          {onClose && (
            <button
              onClick={onClose}
              className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-white/10"
              aria-label="Close panel"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Token comparison stats */}
      <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-xs">
        <div className="flex items-center gap-4">
          {/* Visible Context tokens */}
          <div>
            <span className="text-muted-foreground">Visible: </span>
            <span className="font-medium tabular-nums text-muted-foreground">
              ~{formatTokens(totalTokens)}
            </span>
          </div>
          {/* Total Session tokens (if provided) */}
          {totalSessionTokens !== undefined && totalSessionTokens > 0 && (
            <div>
              <span className="text-muted-foreground">Total: </span>
              <span className="font-medium tabular-nums text-muted-foreground">
                {formatTokens(totalSessionTokens)}
              </span>
            </div>
          )}
        </div>
        {/* Percentage of total */}
        {totalSessionTokens !== undefined && totalSessionTokens > 0 && (
          <span className="rounded-sm bg-popover px-1.5 py-0.5 tabular-nums text-muted-foreground">
            {Math.min((totalTokens / totalSessionTokens) * 100, 100).toFixed(1)}% of total
          </span>
        )}
      </div>

      {/* Phase selector - only shown when compactions exist */}
      {phaseInfo && phaseInfo.phases.length > 1 && (
        <div className="border-border/50 mt-2 flex flex-wrap items-center gap-1 border-t pt-2">
          <span className="text-muted-foreground mr-1 text-[10px]">Phase:</span>
          {phaseInfo.phases.map((phase) => (
            <button
              key={phase.phaseNumber}
              onClick={() =>
                onPhaseChange(phase.phaseNumber === selectedPhase ? null : phase.phaseNumber)
              }
              className={cn(
                'rounded-sm px-1.5 py-0.5 text-[10px] transition-colors',
                selectedPhase === phase.phaseNumber
                  ? 'bg-indigo-500/15 text-indigo-400'
                  : 'bg-popover text-muted-foreground'
              )}
            >
              {phase.phaseNumber}
            </button>
          ))}
          <button
            onClick={() => onPhaseChange(null)}
            className={cn(
              'rounded-sm px-1.5 py-0.5 text-[10px] transition-colors',
              selectedPhase === null
                ? 'bg-indigo-500/15 text-indigo-400'
                : 'bg-popover text-muted-foreground'
            )}
          >
            Current
          </button>
        </div>
      )}

      {/* View mode toggle */}
      <div className="border-border/50 mt-2 flex items-center gap-1 border-t pt-2">
        <span className="text-muted-foreground mr-1 text-[10px]">View:</span>
        <button
          onClick={() => onViewModeChange('category')}
          className={cn(
            'flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] transition-colors',
            viewMode === 'category'
              ? 'bg-indigo-500/15 text-indigo-400'
              : 'bg-popover text-muted-foreground'
          )}
        >
          <LayoutList size={10} />
          Category
        </button>
        <button
          onClick={() => onViewModeChange('ranked')}
          className={cn(
            'flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] transition-colors',
            viewMode === 'ranked'
              ? 'bg-indigo-500/15 text-indigo-400'
              : 'bg-popover text-muted-foreground'
          )}
        >
          <ArrowDownWideNarrow size={10} />
          By Size
        </button>
      </div>
    </div>
  );
};
