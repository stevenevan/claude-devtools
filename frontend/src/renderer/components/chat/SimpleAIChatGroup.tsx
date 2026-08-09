import type { JSX } from 'react';

import { StepSummary } from './items/StepSummary';
import { createSearchContext, EMPTY_SEARCH_MATCHES } from './searchHighlightUtils';
import { markdownComponents, createMarkdownComponents } from './markdownComponents';

import { useStore } from '@renderer/store';
import { Bot } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useShallow } from 'zustand/react/shallow';

import type { SimpleChatItem } from '@renderer/types/simpleChat';

interface SimpleAIChatGroupProps {
  item: Extract<SimpleChatItem, { type: 'ai' }>;
}

export const SimpleAIChatGroup = ({ item }: Readonly<SimpleAIChatGroupProps>): JSX.Element => {
  'use no memo';
  const { searchQuery, searchMatches, currentSearchIndex } = useStore(
    useShallow((state) => {
      const hasMatch = state.searchMatchItemIds.has(item.group.id);
      return {
        searchQuery: hasMatch ? state.searchQuery : '',
        searchMatches: hasMatch ? state.searchMatches : EMPTY_SEARCH_MATCHES,
        currentSearchIndex: hasMatch ? state.currentSearchIndex : -1,
      };
    })
  );
  const searchContext = searchQuery
    ? createSearchContext(searchQuery, item.group.id, searchMatches, currentSearchIndex)
    : null;
  const components = searchContext ? createMarkdownComponents(searchContext) : markdownComponents;

  return (
    <article className="space-y-3 border-l-2 border-indigo-500/20 pl-3" aria-label="Claude">
      <div className="text-text-muted flex items-center gap-1.5 text-xs font-semibold">
        <Bot className="size-3.5" aria-hidden="true" />
        <span>Claude</span>
      </div>
      {item.stepSummary && <StepSummary {...item.stepSummary} aiGroupId={item.group.id} />}
      {item.content && (
        <div className="border-border bg-surface-raised overflow-hidden rounded-lg border">
          <div className="max-h-96 overflow-y-auto px-4 py-3 text-sm text-text-secondary" data-search-content>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
              {item.content}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </article>
  );
};
