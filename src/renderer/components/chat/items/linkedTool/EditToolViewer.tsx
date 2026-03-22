/**
 * EditToolViewer
 *
 * Renders the Edit tool with DiffViewer.
 */

import React from 'react';

import { DiffViewer } from '@renderer/components/chat/viewers';
import { cn } from '@renderer/lib/utils';

import { type ItemStatus, StatusDot } from '../BaseItem';
import { formatTokens } from '../baseItemHelpers';

import { renderOutput } from './renderHelpers';

import type { LinkedToolItem } from '@renderer/types/groups';

interface EditToolViewerProps {
  linkedTool: LinkedToolItem;
  status: ItemStatus;
}

export const EditToolViewer: React.FC<EditToolViewerProps> = ({ linkedTool, status }) => {
  const toolUseResult = linkedTool.result?.toolUseResult as Record<string, unknown> | undefined;

  const filePath = (toolUseResult?.filePath as string) || (linkedTool.input.file_path as string);
  const oldString =
    (toolUseResult?.oldString as string) || (linkedTool.input.old_string as string) || '';
  const newString =
    (toolUseResult?.newString as string) || (linkedTool.input.new_string as string) || '';

  return (
    <div className="space-y-3">
      <DiffViewer
        fileName={filePath}
        oldString={oldString}
        newString={newString}
        tokenCount={linkedTool.callTokens}
      />

      {/* Show result status if available */}
      {!linkedTool.isOrphaned && linkedTool.result != null && (
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs text-[var(--tool-item-muted)]">
            Result
            <StatusDot status={status} />
            {linkedTool.result?.tokenCount !== undefined && linkedTool.result.tokenCount > 0 && (
              <span className="text-text-muted">
                ~{formatTokens(linkedTool.result.tokenCount)} tokens
              </span>
            )}
          </div>
          <div
            className={cn(
              'max-h-96 overflow-auto rounded-sm border border-[var(--code-border)] bg-[var(--code-bg)] p-3 font-mono text-xs',
              status === 'error' ? 'text-[var(--tool-result-error-text)]' : 'text-text-secondary'
            )}
          >
            {renderOutput(linkedTool.result.content)}
          </div>
        </div>
      )}
    </div>
  );
};
