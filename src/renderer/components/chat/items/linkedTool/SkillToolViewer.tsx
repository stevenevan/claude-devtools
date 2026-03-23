/**
 * SkillToolViewer
 *
 * Renders the Skill tool with its instructions in a code block viewer style.
 */

import React from 'react';

import { CodeBlockViewer } from '@renderer/components/chat/viewers';

import type { LinkedToolItem } from '@renderer/types/groups';

interface SkillToolViewerProps {
  linkedTool: LinkedToolItem;
}

export const SkillToolViewer: React.FC<SkillToolViewerProps> = ({ linkedTool }) => {
  const skillInstructions = linkedTool.skillInstructions;
  const skillName = (linkedTool.input.skill as string) || 'Unknown Skill';

  const resultContent = linkedTool.result?.content;
  const resultText =
    typeof resultContent === 'string'
      ? resultContent
      : Array.isArray(resultContent)
        ? resultContent
            .map((item: unknown) => (typeof item === 'string' ? item : JSON.stringify(item)))
            .join('\n')
        : '';

  return (
    <div className="space-y-3">
      {/* Initial result */}
      {resultText && (
        <div>
          <div className="text-muted-foreground mb-1 text-xs">Result</div>
          <div className="border-border bg-muted text-muted-foreground overflow-x-auto rounded-sm border p-3 font-mono text-xs">
            {resultText}
          </div>
        </div>
      )}

      {/* Skill instructions */}
      {skillInstructions && (
        <div>
          <div className="text-muted-foreground mb-1 text-xs">Skill Instructions</div>
          <CodeBlockViewer
            fileName={`${skillName} skill`}
            content={skillInstructions}
            startLine={1}
          />
        </div>
      )}
    </div>
  );
};
