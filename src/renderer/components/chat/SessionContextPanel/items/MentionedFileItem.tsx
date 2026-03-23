/**
 * MentionedFileItem - Single mentioned file item display.
 */

import React from 'react';

import { CopyablePath } from '@renderer/components/common/CopyablePath';
import { resolveAbsolutePath, shortenDisplayPath } from '@renderer/utils/pathDisplay';
import { File } from 'lucide-react';

import { formatTokens } from '../utils/formatting';

import type { MentionedFileInjection } from '@renderer/types/contextInjection';

interface MentionedFileItemProps {
  injection: MentionedFileInjection;
  projectRoot?: string;
  onNavigateToTurn?: (turnIndex: number) => void;
}

export const MentionedFileItem = ({
  injection,
  projectRoot,
  onNavigateToTurn,
}: Readonly<MentionedFileItemProps>): React.ReactElement => {
  const turnIndex = injection.firstSeenTurnIndex;
  const isClickable = onNavigateToTurn && turnIndex >= 0;
  const displayPath = shortenDisplayPath(injection.path, projectRoot);
  const absolutePath = resolveAbsolutePath(injection.path, projectRoot);

  return (
    <div className="rounded-sm px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <File size={12} className="text-muted-foreground shrink-0" />
        <CopyablePath
          displayText={displayPath}
          copyText={absolutePath}
          className="text-muted-foreground text-xs"
        />
        {!injection.exists && (
          <span className="rounded-sm bg-red-900/20 px-1 py-0.5 text-xs text-red-400">missing</span>
        )}
      </div>
      <div className="mt-0.5 ml-4 flex items-center gap-2">
        <span className="text-muted-foreground text-xs">
          ~{formatTokens(injection.estimatedTokens)} tokens
        </span>
        {isClickable ? (
          <span
            role="link"
            tabIndex={0}
            className="cursor-pointer text-xs text-blue-400 underline decoration-dotted underline-offset-2 transition-opacity hover:opacity-80"
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
          <span className="text-muted-foreground text-xs opacity-70">@Turn {turnIndex + 1}</span>
        )}
      </div>
    </div>
  );
};
