/**
 * ToolBreakdownItem - Single tool breakdown item display.
 */

import React from 'react';

import { formatTokens } from '../utils/formatting';

import type { ToolTokenBreakdown } from '@renderer/types/contextInjection';

interface ToolBreakdownItemProps {
  tool: ToolTokenBreakdown;
}

export const ToolBreakdownItem = ({
  tool,
}: Readonly<ToolBreakdownItemProps>): React.ReactElement => {
  return (
    <div className="flex items-center gap-2 py-0.5 text-xs">
      <span className="text-text-muted">{tool.toolName}</span>
      <span className="text-text-muted opacity-70">~{formatTokens(tool.tokenCount)}</span>
      {tool.isError && (
        <span
          className="rounded-sm px-1 py-0.5 text-[10px]"
          style={{
            backgroundColor: 'var(--color-error-subtle)',
            color: 'var(--color-error)',
          }}
        >
          error
        </span>
      )}
    </div>
  );
};
