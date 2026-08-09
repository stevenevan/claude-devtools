import type { JSX } from 'react';
import { CSSProperties, memo } from 'react';

import { cn } from '@renderer/lib/utils';
import {
  getHighlightProps,
  HIGHLIGHT_CLASSES,
  isPresetColorKey,
  type TriggerColor,
} from '@shared/constants/triggerColors';

import { AIChatGroup } from './AIChatGroup';
import { CompactBoundary } from './CompactBoundary';
import { EventMarker } from './EventMarker';
import { SimpleAIChatGroup } from './SimpleAIChatGroup';
import { SimpleCompactionStatus } from './SimpleCompactionStatus';
import { SimpleUserChatGroup } from './SimpleUserChatGroup';
import { SystemChatGroup } from './SystemChatGroup';
import { UserChatGroup } from './UserChatGroup';
import { isSimpleChatItem } from '@renderer/types/simpleChat';

import type { SimpleChatItem } from '@renderer/types/simpleChat';
import type { ChatItem } from '@renderer/types/groups';

interface ChatHistoryItemProps {
  readonly item: ChatItem | SimpleChatItem;
  readonly highlightedGroupId: string | null;
  readonly highlightToolUseId?: string;
  readonly isSearchHighlight: boolean;
  readonly isNavigationHighlight: boolean;
  readonly highlightColor?: TriggerColor;
  readonly registerChatItemRef: (groupId: string) => (el: HTMLElement | null) => void;
  readonly registerAIGroupRef: (groupId: string) => (el: HTMLElement | null) => void;

  readonly registerToolRef: (toolId: string, el: HTMLElement | null) => void;
}

function getHighlight(
  isHighlighted: boolean,
  isSearchHighlight: boolean,
  isNavigationHighlight: boolean,
  highlightColor?: TriggerColor
): { className: string; style?: CSSProperties } {
  if (!isHighlighted) return { className: 'ring-0 bg-transparent' };
  if (isSearchHighlight) return { className: 'ring-2 ring-yellow-500/30 bg-yellow-500/5' };
  if (isNavigationHighlight) return { className: 'ring-2 ring-blue-500/30 bg-blue-500/5' };
  const key = highlightColor ?? 'red';
  if (isPresetColorKey(key)) return { className: HIGHLIGHT_CLASSES[key] };
  return getHighlightProps(key);
}

const ChatHistoryItemInner = ({
  item,
  highlightedGroupId,
  highlightToolUseId,
  isSearchHighlight,
  isNavigationHighlight,
  highlightColor,
  registerChatItemRef,
  registerAIGroupRef,
  registerToolRef,
}: ChatHistoryItemProps): JSX.Element | null => {
  if (isSimpleChatItem(item)) {
    const isHighlighted = highlightedGroupId === item.group.id;
    const hl = getHighlight(isHighlighted, isSearchHighlight, isNavigationHighlight, highlightColor);

    switch (item.type) {
      case 'user':
        return (
          <div
            ref={registerChatItemRef(item.group.id)}
            className={cn('rounded-lg transition-all duration-[3000ms] ease-out', hl.className)}
            style={hl.style}
          >
            <SimpleUserChatGroup item={item} />
          </div>
        );
      case 'ai':
        return (
          <div
            ref={registerAIGroupRef(item.group.id)}
            className={cn('rounded-lg transition-all duration-[3000ms] ease-out', hl.className)}
            style={hl.style}
          >
            <SimpleAIChatGroup item={item} />
          </div>
        );
      case 'compact':
        return <SimpleCompactionStatus content={item.content} />;
    }
  }

  switch (item.type) {
    case 'user': {
      const isHighlighted = highlightedGroupId === item.group.id;
      const hl = getHighlight(
        isHighlighted,
        isSearchHighlight,
        isNavigationHighlight,
        highlightColor
      );
      return (
        <div
          ref={registerChatItemRef(item.group.id)}
          className={cn('rounded-lg transition-all duration-[3000ms] ease-out', hl.className)}
          style={hl.style}
        >
          <UserChatGroup userGroup={item.group} />
        </div>
      );
    }
    case 'system': {
      const isHighlighted = highlightedGroupId === item.group.id;
      const hl = getHighlight(
        isHighlighted,
        isSearchHighlight,
        isNavigationHighlight,
        highlightColor
      );
      return (
        <div
          ref={registerChatItemRef(item.group.id)}
          className={cn('rounded-lg transition-all duration-[3000ms] ease-out', hl.className)}
          style={hl.style}
        >
          <SystemChatGroup systemGroup={item.group} />
        </div>
      );
    }
    case 'ai': {
      const isHighlighted = highlightedGroupId === item.group.id;
      // Pass highlightToolUseId to ALL AI groups (when not search highlight)
      // Each group will check if it contains the tool and expand accordingly
      // Allowed during navigation highlights so context panel tool deep-linking works
      const toolUseIdForGroup = !isSearchHighlight ? highlightToolUseId : undefined;
      const hl = getHighlight(
        isHighlighted,
        isSearchHighlight,
        isNavigationHighlight,
        highlightColor
      );
      return (
        <div
          ref={registerAIGroupRef(item.group.id)}
          className={cn('rounded-lg transition-all duration-[3000ms] ease-out', hl.className)}
          style={hl.style}
        >
          <AIChatGroup
            aiGroup={item.group}
            highlightToolUseId={toolUseIdForGroup}
            highlightColor={highlightColor}
            registerToolRef={registerToolRef}
          />
        </div>
      );
    }
    case 'compact':
      return <CompactBoundary compactGroup={item.group} />;
    case 'event':
      return <EventMarker eventGroup={item.group} />;
    default:
      return null;
  }
};

// ponytail: memo kept — virtualized row
export const ChatHistoryItem = memo(ChatHistoryItemInner);
