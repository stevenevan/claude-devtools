import { parseAllTeammateMessages } from '@shared/utils/teammateMessageParser';

import { estimateTokens, toDate } from '../aiGroupHelpers';
import { extractSlashes, type PrecedingSlashInfo } from '../slashCommandExtractor';
import { linkToolCallsToResults } from '../toolLinkingEngine';

import { linkTeammateReplies, sortDisplayItemsChronologically } from './helpers';

import type { ParsedMessage, Process, SemanticStep } from '../../types/data';
import type { AIGroupDisplayItem, AIGroupLastOutput } from '../../types/groups';

/**
 * Build a flat chronological list of display items for the AI Group.
 *
 * Strategy:
 * 1. Skip the step that represents lastOutput (to avoid duplication)
 * 2. For tool_call steps, use the LinkedToolItem (which includes the result)
 * 3. Skip standalone tool_result steps (already linked to calls)
 * 4. Skip Task tool_call steps that have associated subagents (avoid duplication)
 * 5. Include thinking, subagent, and output steps
 * 6. Return items in chronological order
 *
 * @param steps - Semantic steps from the AI Group
 * @param lastOutput - The last output to skip
 * @param subagents - Subagents associated with this group
 * @param responses - Optional raw messages for extracting slash instructions
 * @param precedingSlash - Optional slash info from the preceding UserGroup
 * @returns Flat array of display items
 */
export function buildDisplayItems(
  steps: SemanticStep[],
  lastOutput: AIGroupLastOutput | null,
  subagents: Process[],
  responses?: ParsedMessage[],
  precedingSlash?: PrecedingSlashInfo
): AIGroupDisplayItem[] {
  const displayItems: AIGroupDisplayItem[] = [];
  const linkedTools = linkToolCallsToResults(steps, responses);

  // Build set of Task IDs that have associated subagents
  // This prevents duplicate display of Task tool calls when subagents are shown
  const taskIdsWithSubagents = new Set<string>(
    subagents.map((s) => s.parentTaskId).filter((id): id is string => !!id)
  );

  // Find the step ID of lastOutput to skip it
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

  // Build display items
  for (const step of steps) {
    // Skip the last output step
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
          // Skip Task tool calls that have associated subagents
          // The subagent will be shown separately, so showing the Task call is redundant
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
        // Skip - these are already included in LinkedToolItem
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

  // Add teammate messages from responses (one user message may contain multiple blocks)
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

  // Sort all items chronologically to ensure slashes appear in correct order
  sortDisplayItemsChronologically(displayItems);

  // Link TeammateMessages to their triggering SendMessage calls
  linkTeammateReplies(displayItems);

  return displayItems;
}
