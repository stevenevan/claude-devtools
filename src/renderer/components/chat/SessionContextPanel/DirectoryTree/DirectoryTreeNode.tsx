/**
 * DirectoryTreeNode - Recursive component for rendering directory tree nodes.
 */

import React, { useState } from 'react';

import { CopyablePath } from '@renderer/components/common/CopyablePath';
import { cn } from '@renderer/lib/utils';
import { ChevronRight } from 'lucide-react';

import { formatTokens } from '../utils/formatting';
import { formatFirstSeen, parseTurnIndex } from '../utils/pathParsing';

import type { TreeNode } from './types';

interface DirectoryTreeNodeProps {
  node: TreeNode;
  depth?: number;
  onNavigateToTurn?: (turnIndex: number) => void;
}

export const DirectoryTreeNode = ({
  node,
  depth = 0,
  onNavigateToTurn,
}: Readonly<DirectoryTreeNodeProps>): React.ReactElement | null => {
  const [expanded, setExpanded] = useState(true);
  const indent = depth * 12;

  const sortedChildren = Array.from(node.children.values()).sort((a, b) => {
    if (a.isFile && !b.isFile) return -1;
    if (!a.isFile && b.isFile) return 1;
    return a.name.localeCompare(b.name);
  });

  if (node.isFile) {
    const turnIndex = node.firstSeenInGroup ? parseTurnIndex(node.firstSeenInGroup) : -1;
    const isClickable = onNavigateToTurn && turnIndex >= 0;

    return (
      <div
        style={{ paddingLeft: `${indent}px` }}
        className="flex items-center gap-1 py-0.5 text-xs"
      >
        <CopyablePath
          displayText={node.name}
          copyText={node.path}
          className="text-text-secondary text-xs"
        />
        <span className="text-text-muted">(~{formatTokens(node.tokens ?? 0)})</span>
        {node.firstSeenInGroup &&
          (isClickable ? (
            <button
              type="button"
              className="cursor-pointer text-xs text-[var(--link-text)] underline decoration-dotted underline-offset-2 transition-opacity hover:opacity-80"
              onClick={() => onNavigateToTurn(turnIndex)}
            >
              @{formatFirstSeen(node.firstSeenInGroup)}
            </button>
          ) : (
            <span className="text-text-muted text-xs opacity-70">
              @{formatFirstSeen(node.firstSeenInGroup)}
            </span>
          ))}
      </div>
    );
  }

  return (
    <div>
      {node.name && (
        <div
          role="button"
          tabIndex={0}
          style={{ paddingLeft: `${indent}px` }}
          className="flex cursor-pointer items-center gap-1 py-0.5 text-xs hover:opacity-80"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              setExpanded(!expanded);
            }
          }}
        >
          <ChevronRight
            className={cn('text-text-muted size-3 shrink-0 transition-transform', expanded && 'rotate-90')}
          />
          <span className="text-text-muted">{node.name}/</span>
        </div>
      )}
      {expanded &&
        sortedChildren.map((child) => (
          <DirectoryTreeNode
            key={child.name}
            node={child}
            depth={node.name ? depth + 1 : depth}
            onNavigateToTurn={onNavigateToTurn}
          />
        ))}
    </div>
  );
};
