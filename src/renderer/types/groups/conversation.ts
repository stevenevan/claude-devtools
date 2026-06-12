import type { SystemEventData } from '@shared/types/messages';

import type { CompactionTokenDelta } from '../contextInjection';
import type { ParsedMessage } from '../data';
import type { AIGroup } from './aiGroups';
import type { UserGroup } from './userGroups';

/**
 * System Group - represents command output rendered like AI.
 */
export interface SystemGroup {
  id: string;
  message: ParsedMessage;
  timestamp: Date;
  commandOutput: string; // Raw output text
  commandName?: string; // Optional: extracted command name
}

/**
 * Compact Group - marks where conversation was compacted.
 * Contains the compact summary message with the conversation summary.
 */
export interface CompactGroup {
  id: string;
  timestamp: Date;
  message: ParsedMessage; // Contains compact summary in message.content
  tokenDelta?: CompactionTokenDelta;
  startingPhaseNumber?: number;
}

/**
 * Chat item - can be user, system, ai, or compact.
 * These are INDEPENDENT items in a flat list, not paired turns.
 */
/**
 * Event group — a system event displayed as an inline marker.
 */
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

/**
 * Session conversation as a flat list of independent chat items.
 * NO LONGER uses turns - each item stands alone.
 */
export interface SessionConversation {
  /** Session ID */
  sessionId: string;
  /** All chat items in chronological order */
  items: ChatItem[];
  /** Total count of user groups */
  totalUserGroups: number;
  /** Total count of system groups */
  totalSystemGroups: number;
  /** Total count of AI groups */
  totalAIGroups: number;
  /** Total count of compact groups */
  totalCompactGroups: number;
  /** Total count of event groups */
  totalEventGroups: number;
}
