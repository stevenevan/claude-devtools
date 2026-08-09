import type { ChatItem, SessionConversation } from './groups';

export interface SimpleStep {
  id: string;
  text: string;
}

export interface SimpleStepSummary {
  id: string;
  steps: SimpleStep[];
}

export type SimpleChatItem =
  | {
      type: 'user';
      id: string;
      group: { id: string };
      content: string;
    }
  | {
      type: 'ai';
      id: string;
      group: { id: string; turnIndex: number };
      content: string;
      stepSummary: SimpleStepSummary | null;
    }
  | {
      type: 'compact';
      id: string;
      group: { id: string };
      content: 'Older messages were summarised to save space';
    };

export interface SimpleConversation {
  mode: 'simple';
  sessionId: string;
  items: SimpleChatItem[];
}

export type SearchableConversation = SessionConversation | SimpleConversation;

export function isSimpleConversation(
  conversation: SearchableConversation
): conversation is SimpleConversation {
  return 'mode' in conversation && conversation.mode === 'simple';
}

export function isSimpleChatItem(item: ChatItem | SimpleChatItem): item is SimpleChatItem {
  return 'id' in item;
}
