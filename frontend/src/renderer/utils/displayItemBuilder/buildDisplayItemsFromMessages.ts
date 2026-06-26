import { parseAllTeammateMessages } from '@shared/utils/teammateMessageParser';

import { estimateTokens, formatToolInput, formatToolResult, toDate } from '../aiGroupHelpers';
import { extractSlashes } from '../slashCommandExtractor';

import { linkTeammateReplies, sortDisplayItemsChronologically } from './helpers';

import type { ParsedMessage, Process } from '../../types/data';
import type { AIGroupDisplayItem, LinkedToolItem } from '../../types/groups';

export function buildDisplayItemsFromMessages(
  messages: ParsedMessage[],
  subagents: Process[] = []
): AIGroupDisplayItem[] {
  const displayItems: AIGroupDisplayItem[] = [];

  const toolCallsById = new Map<
    string,
    {
      id: string;
      name: string;
      input: Record<string, unknown>;
      timestamp: Date;
      sourceMessageId: string;
      sourceModel?: string;
    }
  >();

  const toolResultsById = new Map<
    string,
    {
      content: string | unknown[];
      isError: boolean;
      toolUseResult?: Record<string, unknown>;
      timestamp: Date;
    }
  >();

  const skillInstructionsById = new Map<string, string>();

  const taskIdsWithSubagents = new Set<string>(
    subagents.map((s) => s.parentTaskId).filter((id): id is string => !!id)
  );

  let compactionCount = 0;

  // Helper to get the last assistant's total input tokens before a given index
  // Note: don't filter by isSidechain — subagent messages all have isSidechain=true
  function getLastAssistantInputTokens(idx: number): number {
    for (let i = idx - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.type === 'assistant' && m.usage && m.model !== '<synthetic>') {
        return (
          (m.usage.input_tokens ?? 0) +
          (m.usage.cache_read_input_tokens ?? 0) +
          (m.usage.cache_creation_input_tokens ?? 0)
        );
      }
    }
    return 0;
  }

  function getFirstAssistantInputTokens(idx: number): number {
    for (let i = idx + 1; i < messages.length; i++) {
      const m = messages[i];
      if (m.type === 'assistant' && m.usage && m.model !== '<synthetic>') {
        return (
          (m.usage.input_tokens ?? 0) +
          (m.usage.cache_read_input_tokens ?? 0) +
          (m.usage.cache_creation_input_tokens ?? 0)
        );
      }
    }
    return 0;
  }

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const msg = messages[messageIndex];
    const msgTimestamp = toDate(msg.timestamp);

    if (msg.isCompactSummary) {
      const preTokens = getLastAssistantInputTokens(messageIndex);
      const postTokens = getFirstAssistantInputTokens(messageIndex);
      const rawText =
        typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content
                .filter((b: { type: string; text?: string }) => b.type === 'text')
                .map((b: { type: string; text?: string }) => b.text ?? '')
                .join('\n\n')
            : '';
      displayItems.push({
        type: 'compact_boundary',
        content: rawText,
        timestamp: msgTimestamp,
        tokenDelta:
          preTokens > 0
            ? {
                preCompactionTokens: preTokens,
                postCompactionTokens: postTokens,
                delta: postTokens - preTokens,
              }
            : undefined,
        phaseNumber: compactionCount + 2,
      });
      compactionCount++;
      continue;
    }

    if (msg.type === 'user' && !msg.isMeta) {
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
      if (parsedBlocks.length > 0) {
        for (const parsed of parsedBlocks) {
          displayItems.push({
            type: 'teammate_message',
            teammateMessage: {
              id: `${msg.uuid}-${parsed.teammateId}-${displayItems.length}`,
              teammateId: parsed.teammateId,
              color: parsed.color,
              summary: parsed.summary,
              content: parsed.content,
              timestamp: msgTimestamp,
              tokenCount: estimateTokens(parsed.content),
            },
          });
        }
        continue;
      }
      const hasToolResults =
        Array.isArray(msg.content) && msg.content.some((b) => b.type === 'tool_result');
      if (rawText.trim() && !hasToolResults) {
        displayItems.push({
          type: 'subagent_input',
          content: rawText.trim(),
          timestamp: msgTimestamp,
          tokenCount: estimateTokens(rawText),
        });
        continue;
      }
    }

    if (msg.type === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'thinking' && block.thinking) {
          displayItems.push({
            type: 'thinking',
            content: block.thinking,
            timestamp: msgTimestamp,
            tokenCount: estimateTokens(block.thinking),
          });
        } else if (block.type === 'tool_use' && block.id && block.name) {
          toolCallsById.set(block.id, {
            id: block.id,
            name: block.name,
            input: block.input ?? {},
            timestamp: msgTimestamp,
            sourceMessageId: msg.uuid,
            sourceModel: msg.model,
          });
        } else if (block.type === 'text' && block.text) {
          displayItems.push({
            type: 'output',
            content: block.text,
            timestamp: msgTimestamp,
            tokenCount: estimateTokens(block.text),
          });
        }
      }
    } else if (msg.type === 'user' && (msg.isMeta || msg.toolResults.length > 0)) {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            toolResultsById.set(block.tool_use_id, {
              content: block.content ?? '',
              isError: block.is_error ?? false,
              toolUseResult: msg.toolUseResult,
              timestamp: msgTimestamp,
            });
          }

          if (block.type === 'text' && block.text && msg.sourceToolUseID) {
            const text = block.text;
            if (text.startsWith('Base directory for this skill:')) {
              skillInstructionsById.set(msg.sourceToolUseID, text);
            }
          }
        }
      }

      for (const result of msg.toolResults) {
        if (!toolResultsById.has(result.toolUseId)) {
          toolResultsById.set(result.toolUseId, {
            content: result.content,
            isError: result.isError,
            toolUseResult: msg.toolUseResult,
            timestamp: msgTimestamp,
          });
        }
      }
    }
  }

  for (const [toolId, call] of toolCallsById.entries()) {
    const result = toolResultsById.get(toolId);

    const isTaskWithSubagent = call.name === 'Task' && taskIdsWithSubagents.has(toolId);
    if (isTaskWithSubagent) {
      continue;
    }

    const skillInstructions = call.name === 'Skill' ? skillInstructionsById.get(toolId) : undefined;

    const linkedItem: LinkedToolItem = {
      id: toolId,
      name: call.name,
      input: call.input,
      result: result
        ? {
            content: result.content,
            isError: result.isError,
            toolUseResult: result.toolUseResult,
          }
        : undefined,
      inputPreview: formatToolInput(call.input),
      outputPreview: result ? formatToolResult(result.content) : undefined,
      startTime: call.timestamp,
      endTime: result?.timestamp,
      durationMs: result?.timestamp
        ? result.timestamp.getTime() - call.timestamp.getTime()
        : undefined,
      isOrphaned: !result,
      sourceModel: call.sourceModel,
      skillInstructions,
      skillInstructionsTokenCount: skillInstructions
        ? estimateTokens(skillInstructions)
        : undefined,
    };

    displayItems.push({
      type: 'tool',
      tool: linkedItem,
    });
  }

  for (const subagent of subagents) {
    displayItems.push({
      type: 'subagent',
      subagent: subagent,
    });
  }

  const slashes = extractSlashes(messages);
  for (const slash of slashes) {
    displayItems.push({
      type: 'slash',
      slash,
    });
  }

  sortDisplayItemsChronologically(displayItems);

  linkTeammateReplies(displayItems);

  return displayItems;
}
