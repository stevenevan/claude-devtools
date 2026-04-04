import React, { useState } from 'react';

import { cn } from '@renderer/lib/utils';
import { formatTokensCompact as formatTokens } from '@shared/utils/tokenFormatting';
import { format } from 'date-fns';
import { ChevronRight, Layers } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { CopyButton } from '../common/CopyButton';

import { markdownComponents } from './markdownComponents';

import type { CompactGroup } from '@renderer/types/groups';

interface CompactBoundaryProps {
  compactGroup: CompactGroup;
}

/**
 * CompactBoundary displays an interactive, collapsible marker indicating where
 * the conversation was compacted.
 *
 * Features:
 * - Minimalist design with subtle border and hover states
 * - Click to expand/collapse compacted content
 * - Scrollable content area with enforced max-height
 * - Linear/Notion-inspired aesthetics
 */
export const CompactBoundary = ({
  compactGroup,
}: Readonly<CompactBoundaryProps>): React.JSX.Element => {
  const { timestamp, message } = compactGroup;
  const [isExpanded, setIsExpanded] = useState(false);

  const getCompactContent = (): string => {
    if (!message?.content) return '';

    if (typeof message.content === 'string') {
      return message.content;
    }

    // If it's an array of content blocks, extract text
    if (Array.isArray(message.content)) {
      return message.content
        .filter((block: { type: string; text?: string }) => block.type === 'text')
        .map((block: { type: string; text?: string }) => block.text ?? '')
        .join('\n\n');
    }

    return '';
  };

  const compactContent = getCompactContent();

  return (
    <div className="my-6">
      {/* Collapsible Header - Amber/orange accent for distinction */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="group flex w-full cursor-pointer items-center gap-3 overflow-hidden rounded-lg border border-amber-700/40 bg-amber-900/20 px-4 py-2.5 transition-all duration-200"
        aria-expanded={isExpanded}
        aria-label="Toggle compacted content"
      >
        {/* Icon Stack */}
        <div className="flex shrink-0 items-center gap-2 text-amber-300 transition-colors">
          <ChevronRight
            size={16}
            className={cn('transition-transform duration-200', isExpanded && 'rotate-90')}
          />
          <Layers size={16} />
        </div>

        {/* Label */}
        <span className="shrink-0 text-sm font-medium whitespace-nowrap text-amber-300 transition-colors">
          Compacted
        </span>

        {/* Token delta info */}
        {compactGroup.tokenDelta && (
          <span className="text-muted-foreground ml-2 min-w-0 truncate text-xs tabular-nums">
            {formatTokens(compactGroup.tokenDelta.preCompactionTokens)} →{' '}
            {formatTokens(compactGroup.tokenDelta.postCompactionTokens)}
            <span className="text-green-400">
              {' '}
              ({formatTokens(Math.abs(compactGroup.tokenDelta.delta))} freed)
            </span>
          </span>
        )}

        {/* Phase badge */}
        {compactGroup.startingPhaseNumber && (
          <span className="shrink-0 rounded-sm bg-indigo-500/15 px-1.5 py-0.5 text-[10px] whitespace-nowrap text-indigo-400">
            Phase {compactGroup.startingPhaseNumber}
          </span>
        )}

        {/* Timestamp */}
        <span className="text-muted-foreground ml-auto shrink-0 text-xs whitespace-nowrap transition-colors">
          {format(timestamp, 'h:mm:ss a')}
        </span>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="group border-border bg-muted relative mt-2 overflow-hidden rounded-lg border">
          {compactContent && <CopyButton text={compactContent} />}

          {/* Content - scrollable with left accent bar */}
          <div className="max-h-96 overflow-y-auto border-l-2 border-indigo-500/20 px-4 py-3">
            {compactContent ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {compactContent}
              </ReactMarkdown>
            ) : (
              <div className="flex items-start gap-2">
                <Layers size={14} className="text-muted-foreground mt-0.5 shrink-0" />
                <div className="text-muted-foreground text-xs leading-relaxed">
                  <p className="text-muted-foreground mb-1 font-medium">Conversation Compacted</p>
                  <p>
                    Previous messages were summarized to save context. The full conversation history
                    is preserved in the session file.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
