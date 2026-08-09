import type { JSX } from 'react';
import { cn } from '@renderer/lib/utils';
import { type Virtualizer } from '@tanstack/react-virtual';

import { ChatHistoryItem } from './ChatHistoryItem';
import { isSimpleChatItem } from '@renderer/types/simpleChat';

import type { SimpleChatItem } from '@renderer/types/simpleChat';
import type { ChatItem } from '@renderer/types/groups';
import type { TriggerColor } from '@shared/constants/triggerColors';

interface ChatHistoryVirtualizerProps {
  items: Array<ChatItem | SimpleChatItem>;
  shouldVirtualize: boolean;
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>;
  replayMode: string;
  replayCursorIndex: number;
  highlightedGroupId: string | null;
  highlightToolUseId: string | undefined;
  isSearchHighlight: boolean;
  isNavigationHighlight: boolean;
  highlightColor: TriggerColor | undefined;
  registerChatItemRef: (groupId: string) => (el: HTMLElement | null) => void;
  registerAIGroupRef: (groupId: string) => (el: HTMLElement | null) => void;
  registerToolRef: (toolId: string, el: HTMLElement | null) => void;
}

export function getChatItemKey(item: ChatItem | SimpleChatItem): string {
  return isSimpleChatItem(item) ? item.id : item.group.id;
}

export const ChatHistoryVirtualizer = ({
  items,
  shouldVirtualize,
  rowVirtualizer,
  replayMode,
  replayCursorIndex,
  highlightedGroupId,
  highlightToolUseId,
  isSearchHighlight,
  isNavigationHighlight,
  highlightColor,
  registerChatItemRef,
  registerAIGroupRef,
  registerToolRef,
}: ChatHistoryVirtualizerProps): JSX.Element => {
  if (shouldVirtualize) {
    return (
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];
          if (!item) return null;
          const fadedByReplay = replayMode !== 'off' && virtualRow.index > replayCursorIndex;
          return (
            <div
              key={getChatItemKey(item)}
              ref={rowVirtualizer.measureElement}
              data-index={virtualRow.index}
              className={cn('pb-6', fadedByReplay && 'pointer-events-none opacity-25')}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <ChatHistoryItem
                item={item}
                highlightedGroupId={highlightedGroupId}
                highlightToolUseId={highlightToolUseId}
                isSearchHighlight={isSearchHighlight}
                isNavigationHighlight={isNavigationHighlight}
                highlightColor={highlightColor}
                registerChatItemRef={registerChatItemRef}
                registerAIGroupRef={registerAIGroupRef}
                registerToolRef={registerToolRef}
              />
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <>
      {items.map((item, index) => {
        const fadedByReplay = replayMode !== 'off' && index > replayCursorIndex;
        return (
          <div
            key={getChatItemKey(item)}
            className={cn(fadedByReplay && 'pointer-events-none opacity-25')}
          >
            <ChatHistoryItem
              item={item}
              highlightedGroupId={highlightedGroupId}
              highlightToolUseId={highlightToolUseId}
              isSearchHighlight={isSearchHighlight}
              isNavigationHighlight={isNavigationHighlight}
              highlightColor={highlightColor}
              registerChatItemRef={registerChatItemRef}
              registerAIGroupRef={registerAIGroupRef}
              registerToolRef={registerToolRef}
            />
          </div>
        );
      })}
    </>
  );
};
