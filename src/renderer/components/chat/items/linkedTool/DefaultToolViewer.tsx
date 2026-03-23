/**
 * DefaultToolViewer
 *
 * Default rendering for tools that don't have specialized viewers.
 */

import React from 'react';

import { type ItemStatus } from '../BaseItem';

import { CollapsibleOutputSection } from './CollapsibleOutputSection';
import { renderInput, renderOutput } from './renderHelpers';

import type { LinkedToolItem } from '@renderer/types/groups';

interface DefaultToolViewerProps {
  linkedTool: LinkedToolItem;
  status: ItemStatus;
}

export const DefaultToolViewer: React.FC<DefaultToolViewerProps> = ({ linkedTool, status }) => {
  return (
    <>
      {/* Input Section */}
      <div>
        <div className="text-muted-foreground mb-1 text-xs">Input</div>
        <div className="border-border bg-muted text-muted-foreground max-h-96 overflow-auto rounded border p-3 font-mono text-xs">
          {renderInput(linkedTool.name, linkedTool.input)}
        </div>
      </div>

      {/* Output Section — Collapsed by default */}
      {!linkedTool.isOrphaned && linkedTool.result && (
        <CollapsibleOutputSection status={status}>
          {renderOutput(linkedTool.result.content)}
        </CollapsibleOutputSection>
      )}
    </>
  );
};
