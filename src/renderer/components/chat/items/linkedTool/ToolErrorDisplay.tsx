/**
 * ToolErrorDisplay
 *
 * Displays error output for tool results.
 */

import React from 'react';

import { StatusDot } from '../BaseItem';

import { renderOutput } from './renderHelpers';

import type { LinkedToolItem } from '@renderer/types/groups';

interface ToolErrorDisplayProps {
  linkedTool: LinkedToolItem;
}

export const ToolErrorDisplay: React.FC<ToolErrorDisplayProps> = ({ linkedTool }) => {
  if (!linkedTool.result?.isError) return null;

  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-xs text-[var(--tool-item-muted)]">
        Error
        <StatusDot status="error" />
      </div>
      <div className="max-h-96 overflow-auto rounded-sm border border-[var(--code-border)] bg-[var(--code-bg)] p-3 font-mono text-xs text-[var(--tool-result-error-text)]">
        {renderOutput(linkedTool.result.content)}
      </div>
    </div>
  );
};
