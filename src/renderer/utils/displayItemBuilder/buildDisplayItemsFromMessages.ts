import { parseAllTeammateMessages } from '@shared/utils/teammateMessageParser';

import { estimateTokens, formatToolInput, formatToolResult, toDate } from '../aiGroupHelpers';
import { extractSlashes } from '../slashCommandExtractor';

import { linkTeammateReplies, sortDisplayItemsChronologically } from './helpers';

import type { ParsedMessage, Process } from '../../types/data';
import type { AIGroupDisplayItem, LinkedToolItem } from '../../types/groups';

/**
 * Build display items from raw ParsedMessages (used by subagents).
 * This mirrors the logic of buildDisplayItems but works with messages instead of SemanticSteps.
 *
 * Strategy:
 * 1. Extract thinking blocks from assistant messages
 * 2. Extract tool_use blocks from assistant messages -> collect in a Map by ID
 * 3. Extract text output blocks from assistant messages
 * 4. Extract tool_result blocks from user messages (isMeta or toolResults exist)
 * 5. Link tool calls with their results using LinkedToolItem structure
 * 6. Filter Task tool calls that have matching subagents
 * 7. Include subagents as separate items
 * 8. Sort all items chronologically
 *
 * @param messages - Raw ParsedMessages to process
 * @param subagents - Subagents associated with these messages
 * @returns Flat array of display items
 */
export function buildDisplayItemsFromMessages(
  messages: ParsedMessage[],
  subagents: Process[] = []
): AIGroupDisplayItem[] {
  const displayItems: AIGroupDisplayItem[] = [];

  // Maps for tool call/result linking
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

  // Skill tools have follow-up isMeta:true messages with instructions starting with "Base directory for this skill:"
  const skillInstructionsById = new Map<string, string>();

  // Build set of Task IDs that have associated subagents
  // This prevents duplicate display of Task tool calls when subagents are shown
  const taskIdsWithSubagents = new Set<string>(
    subagents.map((s) => s.parentTaskId).filter((id): id is string => !!id)
  );

  // Track compaction events for compact_boundary display items
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

  // Helper to get the first assistant's total input tokens after a given index
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

  // First pass: collect tool calls and tool results from messages
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const msg = messages[messageIndex];
    const msgTimestamp = toDate(msg.timestamp);

    // Detect compact boundary (before regular user message handling)
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

    // Check for teammate messages (non-meta user messages with <teammate-message> content)
    // One user message may contain multiple <teammate-message> blocks
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
      // Only treat as subagent input if there are NO tool_result blocks in this message
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
      // Fall through to tool result processing below if message has tool_results
    }

    if (msg.type === 'assistant' && Array.isArray(msg.content)) {
      // Process assistant message content blocks
      for (const block of msg.content) {
        if (block.type === 'thinking' && block.thinking) {
          displayItems.push({
            type: 'thinking',
            content: block.thinking,
            timestamp: msgTimestamp,
            tokenCount: estimateTokens(block.thinking),
          });
        } else if (block.type === 'tool_use' && block.id && block.name) {
          // Collect tool call for later linking
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
      // Process tool results from internal user messages
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            // Collect tool result for linking
            toolResultsById.set(block.tool_use_id, {
              content: block.content ?? '',
              isError: block.is_error ?? false,
              toolUseResult: msg.toolUseResult,
              timestamp: msgTimestamp,
            });
          }

          // Check for skill instructions: isMeta:true messages with sourceToolUseID
          // containing text starting with "Base directory for this skill:"
          if (block.type === 'text' && block.text && msg.sourceToolUseID) {
            const text = block.text;
            if (text.startsWith('Base directory for this skill:')) {
              skillInstructionsById.set(msg.sourceToolUseID, text);
            }
          }
        }
      }

      // Also check msg.toolResults array (pre-extracted results)
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

  // Second pass: Build LinkedToolItems by matching calls with results
  for (const [toolId, call] of toolCallsById.entries()) {
    const result = toolResultsById.get(toolId);

    // Skip Task tool calls that have associated subagents
    // The subagent will be shown separately, so showing the Task call is redundant
    const isTaskWithSubagent = call.name === 'Task' && taskIdsWithSubagents.has(toolId);
    if (isTaskWithSubagent) {
      continue;
    }

    // Get skill instructions for Skill tool calls
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

  // Sort all items chronologically
  sortDisplayItemsChronologically(displayItems);

  // Link TeammateMessages to their triggering SendMessage calls
  linkTeammateReplies(displayItems);

  return displayItems;
}
