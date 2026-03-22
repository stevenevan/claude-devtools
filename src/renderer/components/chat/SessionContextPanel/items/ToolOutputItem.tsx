/**
 * ToolOutputItem - Single tool output item with expandable breakdown.
 */

import React, { useState } from 'react';

import { ChevronRight, Wrench } from 'lucide-react';

import { formatTokens } from '../utils/formatting';

import { ToolBreakdownItem } from './ToolBreakdownItem';

import type { ToolOutputInjection } from '@renderer/types/contextInjection';

interface ToolOutputItemProps {
  injection: ToolOutputInjection;
  onNavigateToTurn?: (turnIndex: number) => void;
}

export const ToolOutputItem = ({
  injection,
  onNavigateToTurn,
}: Readonly<ToolOutputItemProps>): React.ReactElement => {
  const [expanded, setExpanded] = useState(false);
  const turnIndex = injection.turnIndex;
  const isClickable = onNavigateToTurn && turnIndex >= 0;
  const hasBreakdown = injection.toolBreakdown.length > 0;

  const containerContent = (
    <>
      {hasBreakdown && (
        <ChevronRight
          className={`size-3 shrink-0 text-text-muted transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      )}
      <Wrench size={12} className="shrink-0 text-text-muted" />
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
        {injection.toolCount} tool{injection.toolCount !== 1 ? 's' : ''}
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
          {injection.toolBreakdown.map((tool, idx) => (
            <ToolBreakdownItem key={`${tool.toolName}-${idx}`} tool={tool} />
          ))}
        </div>
      )}
    </div>
  );
};
