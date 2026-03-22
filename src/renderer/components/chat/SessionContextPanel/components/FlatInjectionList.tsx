/**
 * FlatInjectionList - Completely denested view where every individual tool call,
 * thinking block, and coordination item is its own row, sorted by token size descending.
 * Makes it obvious whether a single large tool or many small ones are consuming tokens.
 */

import React, { useMemo } from 'react';

import { CopyButton } from '@renderer/components/common/CopyButton';

import { formatTokens } from '../utils/formatting';
import { parseTurnIndex } from '../utils/pathParsing';

import type { ContextInjection } from '@renderer/types/contextInjection';

// =============================================================================
// Constants
// =============================================================================

const CATEGORY_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  'claude-md': {
    bg: 'var(--ctx-claudemd-bg)',
    text: 'var(--ctx-claudemd-text)',
    label: 'CLAUDE.md',
  },
  'mentioned-file': { bg: 'var(--ctx-file-bg)', text: 'var(--ctx-file-text)', label: 'File' },
  'tool-output': { bg: 'var(--ctx-tool-bg)', text: 'var(--ctx-tool-text)', label: 'Tool' },
  'thinking-text': {
    bg: 'var(--ctx-thinking-bg)',
    text: 'var(--ctx-thinking-text)',
    label: 'Thinking',
  },
  'task-coordination': { bg: 'var(--ctx-team-bg)', text: 'var(--ctx-team-text)', label: 'Team' },
  'user-message': { bg: 'var(--ctx-user-bg)', text: 'var(--ctx-user-text)', label: 'User' },
};

// =============================================================================
// Types
// =============================================================================

interface FlatRow {
  key: string;
  category: string;
  label: string;
  description: string;
  tokens: number;
  turnIndex: number;
  toolUseId?: string;
  isError?: boolean;
  copyPath?: string;
  navigationType: 'tool' | 'turn' | 'user-group';
}

interface FlatInjectionListProps {
  injections: ContextInjection[];
  onNavigateToTurn?: (turnIndex: number) => void;
  onNavigateToTool?: (turnIndex: number, toolUseId: string) => void;
  onNavigateToUserGroup?: (turnIndex: number) => void;
}

// =============================================================================
// Helpers
// =============================================================================

function flattenInjections(injections: ContextInjection[]): FlatRow[] {
  const rows: FlatRow[] = [];

  for (const inj of injections) {
    switch (inj.category) {
      case 'tool-output':
        if (inj.toolBreakdown.length > 0) {
          for (const tool of inj.toolBreakdown) {
            rows.push({
              key: `${inj.id}-${tool.toolName}-${tool.toolUseId ?? rows.length}`,
              category: 'tool-output',
              label: tool.toolName,
              description: `Turn ${inj.turnIndex + 1}`,
              tokens: tool.tokenCount,
              turnIndex: inj.turnIndex,
              toolUseId: tool.toolUseId,
              isError: tool.isError,
              navigationType: tool.toolUseId ? 'tool' : 'turn',
            });
          }
        } else {
          rows.push({
            key: inj.id,
            category: 'tool-output',
            label: `${inj.toolCount} tool${inj.toolCount !== 1 ? 's' : ''}`,
            description: `Turn ${inj.turnIndex + 1}`,
            tokens: inj.estimatedTokens,
            turnIndex: inj.turnIndex,
            navigationType: 'turn',
          });
        }
        break;

      case 'thinking-text':
        for (const item of inj.breakdown) {
          rows.push({
            key: `${inj.id}-${item.type}`,
            category: 'thinking-text',
            label: item.type === 'thinking' ? 'Thinking' : 'Text',
            description: `Turn ${inj.turnIndex + 1}`,
            tokens: item.tokenCount,
            turnIndex: inj.turnIndex,
            navigationType: 'turn',
          });
        }
        break;

      case 'task-coordination':
        for (const item of inj.breakdown) {
          rows.push({
            key: `${inj.id}-${item.type}-${item.label}`,
            category: 'task-coordination',
            label: item.toolName ?? item.label,
            description: `Turn ${inj.turnIndex + 1}`,
            tokens: item.tokenCount,
            turnIndex: inj.turnIndex,
            navigationType: 'turn',
          });
        }
        break;

      case 'claude-md':
        rows.push({
          key: inj.id,
          category: 'claude-md',
          label: inj.displayName || inj.path,
          description: '',
          tokens: inj.estimatedTokens,
          turnIndex: parseTurnIndex(inj.firstSeenInGroup),
          copyPath: inj.path,
          navigationType: 'turn',
        });
        break;

      case 'mentioned-file':
        rows.push({
          key: inj.id,
          category: 'mentioned-file',
          label: inj.displayName,
          description: '',
          tokens: inj.estimatedTokens,
          turnIndex: inj.firstSeenTurnIndex,
          copyPath: inj.path,
          navigationType: 'turn',
        });
        break;

      case 'user-message':
        rows.push({
          key: inj.id,
          category: 'user-message',
          label: inj.textPreview,
          description: '',
          tokens: inj.estimatedTokens,
          turnIndex: inj.turnIndex,
          navigationType: 'user-group',
        });
        break;
    }
  }

  return rows.sort((a, b) => b.tokens - a.tokens);
}

// =============================================================================
// Component
// =============================================================================

export const FlatInjectionList = ({
  injections,
  onNavigateToTurn,
  onNavigateToTool,
  onNavigateToUserGroup,
}: Readonly<FlatInjectionListProps>): React.ReactElement => {
  const rows = useMemo(() => flattenInjections(injections), [injections]);

  return (
    <div className="space-y-0.5">
      {rows.map((row) => {
        const categoryInfo = CATEGORY_COLORS[row.category] ?? {
          bg: 'var(--ctx-unknown-bg)',
          text: 'var(--ctx-unknown-text)',
          label: row.category,
        };

        const handleClick = (): void => {
          if (row.turnIndex < 0) return;
          if (row.navigationType === 'tool' && row.toolUseId && onNavigateToTool) {
            onNavigateToTool(row.turnIndex, row.toolUseId);
          } else if (row.navigationType === 'user-group' && onNavigateToUserGroup) {
            onNavigateToUserGroup(row.turnIndex);
          } else if (onNavigateToTurn) {
            onNavigateToTurn(row.turnIndex);
          }
        };

        const displayText = row.description ? `${row.label} \u2014 ${row.description}` : row.label;

        return (
          <div key={row.key} className="flex items-center gap-0.5">
            <button
              onClick={handleClick}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-white/5"
            >
              {/* Category pill */}
              <span
                className="shrink-0 rounded-sm px-1.5 py-0.5 text-[9px] font-medium"
                style={{ backgroundColor: categoryInfo.bg, color: categoryInfo.text }}
              >
                {categoryInfo.label}
              </span>
              {/* Description */}
              <span className="text-text-secondary min-w-0 flex-1 truncate text-xs">
                {displayText}
              </span>
              {/* Error badge */}
              {row.isError && (
                <span className="shrink-0 rounded-sm bg-[var(--error-badge-bg)] px-1 py-0.5 text-[10px] text-[var(--error-badge-text)]">
                  error
                </span>
              )}
              {/* Token count */}
              <span className="text-text-muted shrink-0 text-xs font-medium tabular-nums">
                {formatTokens(row.tokens)}
              </span>
            </button>
            {/* Copy path button for CLAUDE.md and File items */}
            {row.copyPath && (
              <span className="shrink-0">
                <CopyButton text={row.copyPath} inline />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};
