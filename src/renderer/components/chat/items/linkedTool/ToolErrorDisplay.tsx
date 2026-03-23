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
      <div className="text-muted-foreground mb-1 flex items-center gap-2 text-xs">
        Error
        <StatusDot status="error" />
      </div>
      <div className="border-border bg-muted max-h-96 overflow-auto rounded-sm border p-3 font-mono text-xs text-red-300">
        {renderOutput(linkedTool.result.content)}
      </div>
    </div>
  );
};
