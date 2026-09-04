import { extractPrecedingSlashInfo } from './AIChatGroup/helpers';
import { enhanceAIGroup } from '../../utils/aiGroupEnhancer';
import { getSimpleToolSummary } from '../../utils/toolRendering/toolSummaryHelpers';
import { sanitizeSimpleText } from '../../utils/simpleTextSanitizer';

import type { PrecedingSlashInfo } from '@renderer/utils/slashCommandExtractor';
import type { AIGroupDisplayItem, ChatItem, SessionConversation } from '@renderer/types/groups';
import type { SimpleChatItem, SimpleConversation, SimpleStepSummary } from '@renderer/types/simpleChat';

export type { SimpleChatItem, SimpleConversation, SimpleStepSummary } from '@renderer/types/simpleChat';

// Sprint 05 Simple thread rules: the narrative thread keeps user prompts
// (sanitized), the assistant's final text, one "what Claude did" card per AI
// turn, and compaction notices. Dropped: thinking blocks, raw tool I/O,
// model IDs, token counts, paths, UUIDs, and system/event items. Consecutive
// duplicate tool steps merge into a single counted step so a retry loop reads
// as one line. The shared grouping engine output shape is untouched.
export const SIMPLE_THREAD_RULES = [
  'user turns keep sanitized text only',
  'ai turns keep final text plus one step card',
  'thinking and raw tool output are dropped',
  'consecutive duplicate steps merge with a repeat count',
  'compaction renders as a fixed status notice',
  'system and event items are omitted',
] as const;

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

  return { id: `simple-steps-${groupId}`, steps: mergeConsecutiveDuplicateSteps(steps) };
}

function mergeConsecutiveDuplicateSteps(
  steps: { id: string; text: string }[]
): { id: string; text: string }[] {
  const merged: { id: string; text: string }[] = [];
  for (const step of steps) {
    const previous = merged[merged.length - 1];
    if (previous && stripRepeatCount(previous.text) === step.text) {
      const count = countStepRepeats(previous.text);
      previous.text = `${stripRepeatCount(previous.text)} (×${count + 1})`;
      continue;
    }
    merged.push({ ...step });
  }
  return merged;
}

function countStepRepeats(text: string): number {
  const match = text.match(/\(×(\d+)\)$/);
  return match?.[1] ? Number.parseInt(match[1], 10) : 1;
}

function stripRepeatCount(text: string): string {
  return text.replace(/ \(×\d+\)$/, '');
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
