import { extractPrecedingSlashInfo } from './AIChatGroup/helpers';
import { enhanceAIGroup } from '../../utils/aiGroupEnhancer';
import { getSimpleToolSummary } from '../../utils/toolRendering/toolSummaryHelpers';
import { sanitizeSimpleText } from '../../utils/simpleTextSanitizer';

import type { PrecedingSlashInfo } from '@renderer/utils/slashCommandExtractor';
import type { AIGroupDisplayItem, ChatItem, SessionConversation } from '@renderer/types/groups';
import type { SimpleChatItem, SimpleConversation, SimpleStepSummary } from '@renderer/types/simpleChat';

export type { SimpleChatItem, SimpleConversation, SimpleStepSummary } from '@renderer/types/simpleChat';

function getPrecedingSlash(items: ChatItem[], index: number): PrecedingSlashInfo | undefined {
  for (let previousIndex = index - 1; previousIndex >= 0; previousIndex--) {
    const previousItem = items[previousIndex];
    if (!previousItem) continue;
    if (previousItem.type === 'user') return extractPrecedingSlashInfo(previousItem.group);
    if (previousItem.type === 'ai') return undefined;
  }

  return undefined;
}

function getSimpleAssistantContent(
  lastOutput: ReturnType<typeof enhanceAIGroup>['lastOutput']
): string {
  if (!lastOutput) return '';

  if (lastOutput.type === 'text') return sanitizeSimpleText(lastOutput.text ?? '');

  if (lastOutput.type === 'plan_exit') return 'Claude prepared a plan.';

  if (lastOutput.type === 'interruption') return 'Claude\'s response was interrupted.';

  return '';
}

function getSimpleStep(item: AIGroupDisplayItem): string | null {
  switch (item.type) {
    case 'tool':
      return getSimpleToolSummary(item.tool.name, item.tool.input);
    case 'subagent':
      return 'Asked a helper for help';
    case 'slash':
      return 'Used a shortcut';
    case 'teammate_message':
      return 'Exchanged a message with a teammate';
    case 'subagent_input':
      return 'Shared context with a helper';
    case 'compact_boundary':
      return 'Continued after a summary';
    case 'thinking':
    case 'output':
      return null;
  }
}

function getSimpleStepSummary(
  groupId: string,
  displayItems: AIGroupDisplayItem[]
): SimpleStepSummary | null {
  const steps = displayItems.flatMap((item, index) => {
    const text = getSimpleStep(item);
    if (!text) return [];

    const itemId =
      item.type === 'tool'
        ? item.tool.id
        : item.type === 'subagent'
          ? item.subagent.id
          : item.type === 'slash'
            ? item.slash.id
            : item.type === 'teammate_message'
              ? item.teammateMessage.id
              : `${item.type}-${index}`;
    return [{ id: `simple-step-${groupId}-${itemId}`, text }];
  });

  if (steps.length === 0) return null;

  return { id: `simple-steps-${groupId}`, steps };
}

function cloneGroupForSimpleEnhancement(item: Extract<ChatItem, { type: 'ai' }>['group']) {
  return {
    ...item,
    processes: item.processes.map((process) => ({ ...process })),
  };
}

export function createSimpleConversation(
  conversation: SessionConversation | null
): SimpleConversation | null {
  if (!conversation) return null;

  const items: SimpleChatItem[] = [];

  for (const [index, item] of conversation.items.entries()) {
    if (item.type === 'user') {
      items.push({
        type: 'user',
        id: `simple-user-${item.group.id}`,
        group: { id: item.group.id },
        content: sanitizeSimpleText(item.group.content.rawText ?? item.group.content.text ?? ''),
      });
      continue;
    }

    if (item.type === 'ai') {
      const enhanced = enhanceAIGroup(
        cloneGroupForSimpleEnhancement(item.group),
        undefined,
        getPrecedingSlash(conversation.items, index)
      );
      items.push({
        type: 'ai',
        id: `simple-claude-${item.group.id}`,
        group: { id: item.group.id, turnIndex: item.group.turnIndex },
        content: getSimpleAssistantContent(enhanced.lastOutput),
        stepSummary: getSimpleStepSummary(item.group.id, enhanced.displayItems),
      });
      continue;
    }

    if (item.type === 'compact') {
      items.push({
        type: 'compact',
        id: `simple-compaction-${item.group.id}`,
        group: { id: item.group.id },
        content: 'Older messages were summarised to save space',
      });
    }
  }

  return { mode: 'simple', sessionId: conversation.sessionId, items };
}
