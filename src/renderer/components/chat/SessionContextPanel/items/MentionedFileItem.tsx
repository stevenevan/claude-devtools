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
        <File size={12} className="shrink-0 text-text-muted" />
        <CopyablePath
          displayText={displayPath}
          copyText={absolutePath}
          className="text-xs text-text-secondary"
        />
        {!injection.exists && (
          <span
            className="rounded-sm px-1 py-0.5 text-xs"
            style={{
              backgroundColor: 'var(--color-error-subtle)',
              color: 'var(--color-error)',
            }}
          >
            missing
          </span>
        )}
      </div>
      <div className="mt-0.5 ml-4 flex items-center gap-2">
        <span className="text-xs text-text-muted">
          ~{formatTokens(injection.estimatedTokens)} tokens
        </span>
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
          <span
            className="text-xs text-text-muted opacity-70"
          >
            @Turn {turnIndex + 1}
          </span>
        )}
      </div>
    </div>
  );
};
