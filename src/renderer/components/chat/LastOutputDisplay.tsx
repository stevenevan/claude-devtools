import React from 'react';

import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { AlertTriangle, CheckCircle, FileCheck, XCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useShallow } from 'zustand/react/shallow';

import { CopyButton } from '../common/CopyButton';
import { OngoingBanner } from '../common/OngoingIndicator';

import { createMarkdownComponents, markdownComponents } from './markdownComponents';
import { createSearchContext, EMPTY_SEARCH_MATCHES } from './searchHighlightUtils';

import type { AIGroupLastOutput } from '@renderer/types/groups';

interface LastOutputDisplayProps {
  lastOutput: AIGroupLastOutput | null;
  aiGroupId: string;
  /** Whether this is the last AI group in the conversation */
  isLastGroup?: boolean;
  /** Whether the session is ongoing (from sessions array, same source as sidebar) */
  isSessionOngoing?: boolean;
}

/**
 * LastOutputDisplay shows the always-visible last text output OR last tool result.
 * This is what the user sees as "the answer" from the AI.
 *
 * Features:
 * - Shows text output with elegant prose styling
 * - Shows tool result with tool name and icon
 * - Handles error states for tool results
 * - Shows timestamp
 * - Expandable for long content
 */
export const LastOutputDisplay = ({
  lastOutput,
  aiGroupId,
  isLastGroup = false,
  isSessionOngoing = false,
}: Readonly<LastOutputDisplayProps>): React.JSX.Element | null => {
  // Only re-render if THIS AI group has search matches
  const { searchQuery, searchMatches, currentSearchIndex } = useStore(
    useShallow((s) => {
      const hasMatch = s.searchMatchItemIds.has(aiGroupId);
      return {
        searchQuery: hasMatch ? s.searchQuery : '',
        searchMatches: hasMatch ? s.searchMatches : EMPTY_SEARCH_MATCHES,
        currentSearchIndex: hasMatch ? s.currentSearchIndex : -1,
      };
    })
  );
  const isTextOutput = lastOutput?.type === 'text' && Boolean(lastOutput.text);

  // Create search context (fresh each render so counter starts at 0)
  const searchCtx =
    searchQuery && isTextOutput
      ? createSearchContext(searchQuery, aiGroupId, searchMatches, currentSearchIndex)
      : null;

  // Create markdown components with optional search highlighting
  // When search is active, create fresh each render (match counter is stateful and must start at 0)
  // useMemo would cache stale closures when parent re-renders without search deps changing
  const mdComponents = searchCtx ? createMarkdownComponents(searchCtx) : markdownComponents;

  // Show ongoing banner if this is the last AI group and session is ongoing
  // This uses the same source (sessions array) as the sidebar green dot for consistency
  if (isLastGroup && isSessionOngoing) {
    return <OngoingBanner />;
  }

  if (!lastOutput) {
    return null;
  }

  const { type } = lastOutput;

  // Render text output
  if (type === 'text' && lastOutput.text) {
    const textContent = lastOutput.text || '';

    return (
      <div className="group relative overflow-hidden rounded-lg border border-border bg-muted">
        <CopyButton text={textContent} />

        {/* Content - scrollable */}
        <div className="max-h-96 overflow-y-auto px-4 py-3" data-search-content>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {textContent}
          </ReactMarkdown>
        </div>
      </div>
    );
  }

  // Render tool result
  if (type === 'tool_result' && lastOutput.toolResult) {
    const isError = lastOutput.isError ?? false;
    const Icon = isError ? XCircle : CheckCircle;

    return (
      <div
        className={cn(
          'overflow-hidden rounded-lg border',
          isError
            ? 'bg-red-900/20 border-red-700/40'
            : 'bg-green-900/20 border-green-700/40'
        )}
      >
        {/* Header */}
        <div
          className={cn(
            'flex items-center gap-2 px-4 py-2 border-b',
            isError
              ? 'border-red-700/40'
              : 'border-green-700/40'
          )}
        >
          <Icon
            className={cn(
              'size-4',
              isError
                ? 'text-red-300'
                : 'text-green-300'
            )}
          />
          {lastOutput.toolName && (
            <code className="rounded-sm border border-border bg-card px-1.5 py-0.5 text-xs text-muted-foreground">
              {lastOutput.toolName}
            </code>
          )}
          {isError && (
            <span className="text-xs font-medium text-red-300">Error</span>
          )}
        </div>

        {/* Content */}
        <div className="px-4 py-3">
          <pre className="text-foreground max-h-96 overflow-y-auto font-mono text-sm break-words whitespace-pre-wrap">
            {lastOutput.toolResult}
          </pre>
        </div>
      </div>
    );
  }

  // Render interruption as a simple horizontal banner
  if (type === 'interruption') {
    return (
      <div className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/15 px-4 py-2">
        <AlertTriangle className="size-4 shrink-0 text-amber-400" />
        <span className="text-sm text-amber-400">Request interrupted by user</span>
      </div>
    );
  }

  // Render plan_exit (ExitPlanMode) with plan content in markdown
  if (type === 'plan_exit' && lastOutput.planContent) {
    const planContent = lastOutput.planContent || '';
    const planPreamble = lastOutput.planPreamble;

    return (
      <div className="space-y-3">
        {/* Preamble text (e.g., "The plan is complete. Let me exit plan mode...") */}
        {planPreamble && (
          <div className="overflow-hidden rounded-lg border border-border bg-muted">
            <div className="px-4 py-3">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                {planPreamble}
              </ReactMarkdown>
            </div>
          </div>
        )}

        {/* Plan content block */}
        <div className="overflow-hidden rounded-lg border border-green-500/25 bg-green-500/5">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-green-500/25 bg-green-500/10 px-4 py-2">
            <div className="flex items-center gap-2">
              <FileCheck className="size-4 text-green-400" />
              <span className="text-sm font-medium text-green-400">
                Plan Ready for Approval
              </span>
            </div>
            <CopyButton text={planContent} inline />
          </div>

          {/* Plan content - scrollable */}
          <div className="max-h-96 overflow-y-auto px-4 py-3">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
              {planContent}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    );
  }

  return null;
};
