import type { JSX } from 'react';

import { createUserMarkdownComponents } from './UserChatGroup/userMarkdownComponents';
import { createSearchContext, EMPTY_SEARCH_MATCHES } from './searchHighlightUtils';

import { useStore } from '@renderer/store';
import { User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useShallow } from 'zustand/react/shallow';

import type { SimpleChatItem } from '@renderer/types/simpleChat';

interface SimpleUserChatGroupProps {
  item: Extract<SimpleChatItem, { type: 'user' }>;
}

export const SimpleUserChatGroup = ({
  item,
}: Readonly<SimpleUserChatGroupProps>): JSX.Element => {
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
  const markdownComponents = createUserMarkdownComponents({}, searchContext);

  return (
    <article className="flex justify-end" aria-label="You">
      <div className="max-w-[85%] space-y-2">
        <div className="text-text-muted flex items-center justify-end gap-1.5 text-xs font-semibold">
          <span>You</span>
          <User className="size-3.5" aria-hidden="true" />
        </div>
        {item.content && (
          <div className="border-border bg-surface-raised rounded-2xl rounded-br-sm border px-4 py-3 text-sm text-text-secondary">
            <div data-search-content>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {item.content}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </article>
  );
};
