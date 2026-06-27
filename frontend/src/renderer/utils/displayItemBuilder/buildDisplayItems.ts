import { parseAllTeammateMessages } from '@shared/utils/teammateMessageParser';

import { estimateTokens } from '@shared/utils/tokenFormatting';

import { toDate } from '../aiGroupHelpers';
import { extractSlashes, type PrecedingSlashInfo } from '../slashCommandExtractor';
import { linkToolCallsToResults } from '../toolLinkingEngine';

import { linkTeammateReplies, sortDisplayItemsChronologically } from './helpers';

import type { ParsedMessage, Process, SemanticStep } from '../../types/data';
import type { AIGroupDisplayItem, AIGroupLastOutput } from '../../types/groups';

export function buildDisplayItems(
  steps: SemanticStep[],
  lastOutput: AIGroupLastOutput | null,
  subagents: Process[],
  responses?: ParsedMessage[],
  precedingSlash?: PrecedingSlashInfo
): AIGroupDisplayItem[] {
  const displayItems: AIGroupDisplayItem[] = [];
  const linkedTools = linkToolCallsToResults(steps, responses);

  const taskIdsWithSubagents = new Set<string>(
    subagents.map((s) => s.parentTaskId).filter((id): id is string => !!id)
  );

  let lastOutputStepId: string | undefined;
  if (lastOutput) {
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i];
      if (
        lastOutput.type === 'text' &&
        step.type === 'output' &&
        step.content.outputText === lastOutput.text
      ) {
        lastOutputStepId = step.id;
        break;
      }
      if (
        lastOutput.type === 'tool_result' &&
        step.type === 'tool_result' &&
        step.content.toolResultContent === lastOutput.toolResult
      ) {
        lastOutputStepId = step.id;
        break;
      }
      if (
        lastOutput.type === 'interruption' &&
        step.type === 'interruption' &&
        step.content.interruptionText === lastOutput.interruptionMessage
      ) {
        lastOutputStepId = step.id;
        break;
      }
    }
  }

  for (const step of steps) {
    if (lastOutputStepId && step.id === lastOutputStepId) {
      continue;
    }

    switch (step.type) {
      case 'thinking':
        if (step.content.thinkingText) {
          displayItems.push({
            type: 'thinking',
            content: step.content.thinkingText,
            timestamp: step.startTime,
            tokenCount: estimateTokens(step.content.thinkingText),
          });
        }
        break;

      case 'tool_call': {
        const linkedTool = linkedTools.get(step.id);
        if (linkedTool) {
          const isTaskWithSubagent =
            linkedTool.name === 'Task' && taskIdsWithSubagents.has(step.id);
          if (!isTaskWithSubagent) {
            displayItems.push({
              type: 'tool',
              tool: linkedTool,
            });
          }
        }
        break;
      }

      case 'tool_result':
        // already linked into LinkedToolItem
        break;

      case 'subagent': {
        const subagentId = step.content.subagentId;
        const subagent = subagents.find((s) => s.id === subagentId);
        if (subagent) {
          displayItems.push({
            type: 'subagent',
            subagent: subagent,
          });
        }
        break;
      }

      case 'output':
        if (step.content.outputText) {
          displayItems.push({
            type: 'output',
            content: step.content.outputText,
            timestamp: step.startTime,
            tokenCount: estimateTokens(step.content.outputText),
          });
        }
        break;

      case 'interruption':
        if (step.content.interruptionText) {
          displayItems.push({
            type: 'output',
            content: step.content.interruptionText,
            timestamp: step.startTime,
            tokenCount: estimateTokens(step.content.interruptionText),
          });
        }
        break;
    }
  }

  if (responses) {
    const slashes = extractSlashes(responses, precedingSlash);
    for (const slash of slashes) {
      displayItems.push({
        type: 'slash',
        slash,
      });
    }
  }

  if (responses) {
    for (const msg of responses) {
      if (msg.type !== 'user' || msg.isMeta) continue;
      const rawText =
        typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content
                .filter((b) => b.type === 'text')
                .map((b) => b.text)
                .join('')
            : '';
      const parsedBlocks = parseAllTeammateMessages(rawText);
      for (const parsed of parsedBlocks) {
        displayItems.push({
          type: 'teammate_message',
          teammateMessage: {
            id: `${msg.uuid}-${parsed.teammateId}-${displayItems.length}`,
            teammateId: parsed.teammateId,
            color: parsed.color,
            summary: parsed.summary,
            content: parsed.content,
            timestamp: toDate(msg.timestamp),
            tokenCount: estimateTokens(parsed.content),
          },
        });
      }
    }
  }

  sortDisplayItemsChronologically(displayItems);

  linkTeammateReplies(displayItems);

  return displayItems;
}
