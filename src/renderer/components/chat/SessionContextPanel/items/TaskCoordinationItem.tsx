/**
 * TaskCoordinationItem - Single task coordination injection with expandable breakdown.
 */

import React, { useState } from 'react';

import { ChevronRight, Users } from 'lucide-react';

import { formatTokens } from '../utils/formatting';

import type { TaskCoordinationInjection } from '@renderer/types/contextInjection';

interface TaskCoordinationItemProps {
  injection: TaskCoordinationInjection;
  onNavigateToTurn?: (turnIndex: number) => void;
}

export const TaskCoordinationItem = ({
  injection,
  onNavigateToTurn,
}: Readonly<TaskCoordinationItemProps>): React.ReactElement => {
  const [expanded, setExpanded] = useState(false);
  const turnIndex = injection.turnIndex;
  const isClickable = onNavigateToTurn && turnIndex >= 0;
  const hasBreakdown = injection.breakdown.length > 0;

  const containerContent = (
    <>
      {hasBreakdown && (
        <ChevronRight
          className={`size-3 shrink-0 text-text-muted transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      )}
      <Users size={12} className="shrink-0 text-text-muted" />
      {isClickable ? (
        <span
          role="link"
          tabIndex={0}
          className="cursor-pointer text-xs text-[#93c5fd] underline decoration-dotted underline-offset-2 transition-opacity hover:opacity-80"
          onClick={(e) => {
            e.stopPropagation();
            onNavigateToTurn(turnIndex);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation();
              onNavigateToTurn(turnIndex);
            }
          }}
        >
          @Turn {turnIndex + 1}
        </span>
      ) : (
        <span className="text-xs text-text-secondary">
          @Turn {turnIndex + 1}
        </span>
      )}
      <span className="text-xs text-text-muted">
        ~{formatTokens(injection.estimatedTokens)} tokens
      </span>
      <span
        className="rounded-sm bg-surface-overlay px-1 py-0.5 text-xs text-text-muted"
      >
        {injection.breakdown.length} item{injection.breakdown.length !== 1 ? 's' : ''}
      </span>
    </>
  );

  return (
    <div className="rounded-sm px-2 py-1.5">
      {hasBreakdown ? (
        <button
          type="button"
          className="flex w-full cursor-pointer items-center gap-1.5 bg-transparent p-0 text-left font-[inherit] hover:opacity-80"
          onClick={() => setExpanded(!expanded)}
        >
          {containerContent}
        </button>
      ) : (
        <div className="flex items-center gap-1.5">{containerContent}</div>
      )}

      {expanded && hasBreakdown && (
        <div className="mt-1 ml-6 space-y-0.5">
          {injection.breakdown.map((item, idx) => (
            <div key={`${item.label}-${idx}`} className="flex items-center justify-between text-xs">
              <span className="text-text-secondary">{item.label}</span>
              <span className="tabular-nums text-text-muted">
                ~{formatTokens(item.tokenCount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
