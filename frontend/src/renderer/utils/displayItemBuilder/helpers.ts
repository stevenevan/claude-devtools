import { toDate } from '../aiGroupHelpers';

import type { AIGroupDisplayItem } from '../../types/groups';

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

export function sortDisplayItemsChronologically(items: AIGroupDisplayItem[]): void {
  items.sort((a, b) => getDisplayItemTimestamp(a).getTime() - getDisplayItemTimestamp(b).getTime());
}

export function linkTeammateReplies(items: AIGroupDisplayItem[]): void {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type !== 'teammate_message') continue;
    const tmMsg = item.teammateMessage;

    for (let j = i - 1; j >= 0; j--) {
      const prev = items[j];
      if (prev.type !== 'tool') continue;
      if (prev.tool.name !== 'SendMessage') continue;
      const input = prev.tool.input;
      if (input.type !== 'message' && input.type !== 'broadcast') continue;
      if (input.type === 'message' && input.recipient !== tmMsg.teammateId) continue;

      tmMsg.replyToSummary = (input.summary as string) || 'message';
      tmMsg.replyToToolId = prev.tool.id;
      break;
    }
  }
}
