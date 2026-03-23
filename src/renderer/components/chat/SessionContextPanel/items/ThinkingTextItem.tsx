/**
 * ThinkingTextItem - Single thinking text item with expandable breakdown.
 */

import React, { useState } from 'react';

import { cn } from '@renderer/lib/utils';
import { Brain, ChevronRight } from 'lucide-react';

import { formatTokens } from '../utils/formatting';

import type { ThinkingTextInjection } from '@renderer/types/contextInjection';

interface ThinkingTextItemProps {
  injection: ThinkingTextInjection;
  onNavigateToTurn?: (turnIndex: number) => void;
}

export const ThinkingTextItem = ({
  injection,
  onNavigateToTurn,
}: Readonly<ThinkingTextItemProps>): React.ReactElement => {
  const [expanded, setExpanded] = useState(false);
  const turnIndex = injection.turnIndex;
  const isClickable = onNavigateToTurn && turnIndex >= 0;

  return (
    <div className="rounded-sm px-2 py-1.5">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-1.5 bg-transparent p-0 text-left font-[inherit] hover:opacity-80"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          className={cn(
            'text-muted-foreground size-3 shrink-0 transition-transform',
            expanded && 'rotate-90'
          )}
        />
        <Brain size={12} className="text-muted-foreground shrink-0" />
        {isClickable ? (
          <span
            role="link"
            tabIndex={0}
            className="cursor-pointer text-xs text-blue-400 underline decoration-dotted underline-offset-2 transition-opacity hover:opacity-80"
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
          <span className="text-muted-foreground text-xs">@Turn {turnIndex + 1}</span>
        )}
        <span className="text-muted-foreground text-xs">
          ~{formatTokens(injection.estimatedTokens)} tokens
        </span>
      </button>

      {expanded && injection.breakdown.length > 0 && (
        <div className="mt-1 ml-6 space-y-0.5">
          {injection.breakdown.map((item, idx) => (
            <div key={`${item.type}-${idx}`} className="flex items-center gap-2 py-0.5 text-xs">
              <span className="text-muted-foreground">
                {item.type === 'thinking' ? 'Thinking' : 'Text'}
              </span>
              <span className="text-muted-foreground opacity-70">
                ~{formatTokens(item.tokenCount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
