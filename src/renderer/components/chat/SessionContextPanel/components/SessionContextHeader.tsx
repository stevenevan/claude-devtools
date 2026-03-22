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
          <FileText size={16} className="text-text-secondary" />
          <h2 className="text-text text-sm font-semibold">Visible Context</h2>
          <span className="bg-surface-overlay text-text-secondary rounded-sm px-1.5 py-0.5 text-xs">
            {injectionCount}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <SessionContextHelpTooltip />
          {onClose && (
            <button
              onClick={onClose}
              className="text-text-secondary rounded-sm p-1 transition-colors hover:bg-white/10"
              aria-label="Close panel"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Token comparison stats */}
      <div className="border-border-subtle mt-2 flex items-center justify-between border-t pt-2 text-xs">
        <div className="flex items-center gap-4">
          {/* Visible Context tokens */}
          <div>
            <span className="text-text-muted">Visible: </span>
            <span className="text-text-secondary font-medium tabular-nums">
              ~{formatTokens(totalTokens)}
            </span>
          </div>
          {/* Total Session tokens (if provided) */}
          {totalSessionTokens !== undefined && totalSessionTokens > 0 && (
            <div>
              <span className="text-text-muted">Total: </span>
              <span className="text-text-secondary font-medium tabular-nums">
                {formatTokens(totalSessionTokens)}
              </span>
            </div>
          )}
        </div>
        {/* Percentage of total */}
        {totalSessionTokens !== undefined && totalSessionTokens > 0 && (
          <span className="bg-surface-overlay text-text-muted rounded-sm px-1.5 py-0.5 tabular-nums">
            {Math.min((totalTokens / totalSessionTokens) * 100, 100).toFixed(1)}% of total
          </span>
        )}
      </div>

      {/* Phase selector - only shown when compactions exist */}
      {phaseInfo && phaseInfo.phases.length > 1 && (
        <div className="border-border-subtle mt-2 flex flex-wrap items-center gap-1 border-t pt-2">
          <span className="text-text-muted mr-1 text-[10px]">Phase:</span>
          {phaseInfo.phases.map((phase) => (
            <button
              key={phase.phaseNumber}
              onClick={() =>
                onPhaseChange(phase.phaseNumber === selectedPhase ? null : phase.phaseNumber)
              }
              className={cn(
                'rounded-sm px-1.5 py-0.5 text-[10px] transition-colors',
                selectedPhase === phase.phaseNumber
                  ? 'bg-[rgba(99,102,241,0.2)] text-[#818cf8]'
                  : 'bg-surface-overlay text-text-muted'
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
                ? 'bg-[rgba(99,102,241,0.2)] text-[#818cf8]'
                : 'bg-surface-overlay text-text-muted'
            )}
          >
            Current
          </button>
        </div>
      )}

      {/* View mode toggle */}
      <div className="border-border-subtle mt-2 flex items-center gap-1 border-t pt-2">
        <span className="text-text-muted mr-1 text-[10px]">View:</span>
        <button
          onClick={() => onViewModeChange('category')}
          className={cn(
            'flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] transition-colors',
            viewMode === 'category'
              ? 'bg-[rgba(99,102,241,0.2)] text-[#818cf8]'
              : 'bg-surface-overlay text-text-muted'
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
              ? 'bg-[rgba(99,102,241,0.2)] text-[#818cf8]'
              : 'bg-surface-overlay text-text-muted'
          )}
        >
          <ArrowDownWideNarrow size={10} />
          By Size
        </button>
      </div>
    </div>
  );
};
