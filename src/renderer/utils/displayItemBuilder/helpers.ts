import { toDate } from '../aiGroupHelpers';

import type { AIGroupDisplayItem } from '../../types/groups';

/**
 * Get the timestamp from a display item for sorting.
 */
function getDisplayItemTimestamp(item: AIGroupDisplayItem): Date {
  switch (item.type) {
    case 'thinking':
    case 'output':
      return toDate(item.timestamp);
    case 'tool':
      return toDate(item.tool.startTime);
    case 'subagent':
      return toDate(item.subagent.startTime);
    case 'slash':
      return toDate(item.slash.timestamp);
    case 'teammate_message':
      return toDate(item.teammateMessage.timestamp);
    case 'subagent_input':
    case 'compact_boundary':
      return toDate(item.timestamp);
  }
}

/**
 * Sort display items chronologically.
 */
export function sortDisplayItemsChronologically(items: AIGroupDisplayItem[]): void {
  items.sort((a, b) => getDisplayItemTimestamp(a).getTime() - getDisplayItemTimestamp(b).getTime());
}

/**
 * Link TeammateMessages to their triggering SendMessage calls.
 * For each TeammateMessage, scans backwards through chronologically sorted items
 * to find the most recent SendMessage to that teammate.
 * Only matches type: "message" or "broadcast" (not shutdown_request/shutdown_response).
 * Proactive messages (no preceding SendMessage) get no badge.
 */
export function linkTeammateReplies(items: AIGroupDisplayItem[]): void {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type !== 'teammate_message') continue;
    const tmMsg = item.teammateMessage;

    // Scan backwards for the most recent SendMessage to this teammate
    for (let j = i - 1; j >= 0; j--) {
      const prev = items[j];
      if (prev.type !== 'tool') continue;
      if (prev.tool.name !== 'SendMessage') continue;
      const input = prev.tool.input;
      // Only match outbound messages (not shutdown_request, shutdown_response, etc.)
      if (input.type !== 'message' && input.type !== 'broadcast') continue;
      // Match by recipient (broadcast goes to all, so always matches)
      if (input.type === 'message' && input.recipient !== tmMsg.teammateId) continue;

      tmMsg.replyToSummary = (input.summary as string) || 'message';
      tmMsg.replyToToolId = prev.tool.id;
      break;
    }
  }
}
