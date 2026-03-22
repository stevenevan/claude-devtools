/**
 * ClaudeMdItem - Single CLAUDE.md file item display.
 */

import React from 'react';

import { CopyablePath } from '@renderer/components/common/CopyablePath';
import { resolveAbsolutePath, shortenDisplayPath } from '@renderer/utils/pathDisplay';

import { formatTokens } from '../utils/formatting';
import { formatFirstSeen, parseTurnIndex } from '../utils/pathParsing';

import type { ClaudeMdContextInjection } from '@renderer/types/contextInjection';

interface ClaudeMdItemProps {
  injection: ClaudeMdContextInjection;
  projectRoot?: string;
  onNavigateToTurn?: (turnIndex: number) => void;
}

export const ClaudeMdItem = ({
  injection,
  projectRoot,
  onNavigateToTurn,
}: Readonly<ClaudeMdItemProps>): React.ReactElement => {
  const turnIndex = parseTurnIndex(injection.firstSeenInGroup);
  const isClickable = onNavigateToTurn && turnIndex >= 0;
  const displayPath = shortenDisplayPath(injection.path, projectRoot);
  const absolutePath = resolveAbsolutePath(injection.path, projectRoot);

  return (
    <div className="rounded-sm px-2 py-1">
      <CopyablePath
        displayText={displayPath}
        copyText={absolutePath}
        className="text-text-secondary text-xs"
      />
      <div className="mt-0.5 flex items-center gap-2">
        <span className="text-text-muted text-xs">
          ~{formatTokens(injection.estimatedTokens)} tokens
        </span>
        {isClickable ? (
          <button
            type="button"
            className="cursor-pointer text-xs text-[#93c5fd] underline decoration-dotted underline-offset-2 transition-opacity hover:opacity-80"
            onClick={() => onNavigateToTurn(turnIndex)}
          >
            @{formatFirstSeen(injection.firstSeenInGroup)}
          </button>
        ) : (
          <span className="text-text-muted text-xs opacity-70">
            @{formatFirstSeen(injection.firstSeenInGroup)}
          </span>
        )}
      </div>
    </div>
  );
};
