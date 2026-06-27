import type { SystemEventData } from '@shared/types/messages';

import type { CompactionTokenDelta } from '../contextInjection';
import type { ParsedMessage } from '../data';
import type { AIGroup } from './aiGroups';
import type { UserGroup } from './userGroups';

export interface SystemGroup {
  id: string;
  message: ParsedMessage;
  timestamp: Date;
  commandOutput: string; // Raw output text
  commandName?: string; // Optional: extracted command name
}

export interface CompactGroup {
  id: string;
  timestamp: Date;
  message: ParsedMessage; // Contains compact summary in message.content
  tokenDelta?: CompactionTokenDelta;
  startingPhaseNumber?: number;
}

export interface EventGroup {
  id: string;
  timestamp: Date;
  message: ParsedMessage;
  eventData: SystemEventData;
}

export type ChatItem =
  | { type: 'user'; group: UserGroup }
  | { type: 'system'; group: SystemGroup }
  | { type: 'ai'; group: AIGroup }
  | { type: 'compact'; group: CompactGroup }
  | { type: 'event'; group: EventGroup };

export interface SessionConversation {

  sessionId: string;

  items: ChatItem[];

  totalUserGroups: number;

  totalSystemGroups: number;

  totalAIGroups: number;

  totalCompactGroups: number;

  totalEventGroups: number;
}
