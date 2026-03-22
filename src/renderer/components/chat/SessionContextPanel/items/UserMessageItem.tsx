/**
 * UserMessageItem - Single user message item showing turn link, tokens, and preview.
 */

import React from 'react';

import { MessageSquare } from 'lucide-react';

import { formatTokens } from '../utils/formatting';

import type { UserMessageInjection } from '@renderer/types/contextInjection';

interface UserMessageItemProps {
  injection: UserMessageInjection;
  onNavigateToTurn?: (turnIndex: number) => void;
}

export const UserMessageItem = ({
  injection,
  onNavigateToTurn,
}: Readonly<UserMessageItemProps>): React.ReactElement => {
  const turnIndex = injection.turnIndex;
  const isClickable = onNavigateToTurn && turnIndex >= 0;

  return (
    <div className="rounded-sm px-2 py-1.5">
      <div className="flex w-full items-center gap-1.5">
        <MessageSquare size={12} className="text-text-muted shrink-0" />
        {isClickable ? (
          <span
            role="link"
            tabIndex={0}
            className="cursor-pointer text-xs text-[#93c5fd] underline decoration-dotted underline-offset-2 transition-opacity hover:opacity-80"
            onClick={() => onNavigateToTurn(turnIndex)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                onNavigateToTurn(turnIndex);
              }
            }}
          >
            @Turn {turnIndex + 1}
          </span>
        ) : (
          <span className="text-text-secondary text-xs">@Turn {turnIndex + 1}</span>
        )}
        <span className="text-text-muted text-xs">
          ~{formatTokens(injection.estimatedTokens)} tokens
        </span>
      </div>
      {injection.textPreview && (
        <div className="text-text-muted mt-0.5 truncate pl-5 text-xs italic opacity-70">
          {injection.textPreview}
        </div>
      )}
    </div>
  );
};
