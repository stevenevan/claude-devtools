import { estimateTokens, formatToolInput, formatToolResult, toDate } from './aiGroupHelpers';

import type { ParsedMessage, SemanticStep } from '../types/data';
import type { LinkedToolItem } from '../types/groups';

export function linkToolCallsToResults(
  steps: SemanticStep[],
  responses?: ParsedMessage[]
): Map<string, LinkedToolItem> {
  const linkedTools = new Map<string, LinkedToolItem>();

  const toolCalls = steps.filter((step) => step.type === 'tool_call');

  const resultStepsById = new Map<string, SemanticStep>();
  for (const step of steps) {
    if (step.type === 'tool_result') {
      resultStepsById.set(step.id, step);
    }
  }

  const skillInstructionsById = new Map<string, string>();

  if (responses) {
    for (const msg of responses) {
      if (msg.type === 'user' && msg.isMeta && msg.sourceToolUseID && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            const text = block.text;
            if (text.startsWith('Base directory for this skill:')) {
              skillInstructionsById.set(msg.sourceToolUseID, text);
            }
          }
        }
      }
    }
  }

  for (const callStep of toolCalls) {
    const toolCallId = callStep.id;
    const toolName = callStep.content.toolName ?? 'Unknown';
    const toolInput = callStep.content.toolInput ?? {};

    const resultStep = resultStepsById.get(toolCallId);
    const callStartTime = toDate(callStep.startTime);
    const resultStartTime = resultStep ? toDate(resultStep.startTime) : undefined;

    // Get skill instructions for Skill tool calls
    const skillInstructions =
      toolName === 'Skill' ? skillInstructionsById.get(toolCallId) : undefined;

    // callTokens = tool name + input size (what actually enters the context window)
    const callTokens = estimateTokens(toolName + JSON.stringify(toolInput));

    const linkedItem: LinkedToolItem = {
      id: toolCallId,
      name: toolName,
      input: toolInput as Record<string, unknown>,
      callTokens,
      result: resultStep
        ? {
            content: resultStep.content.toolResultContent ?? '',
            isError: resultStep.content.isError ?? false,
            toolUseResult: resultStep.content.toolUseResult,
            tokenCount: resultStep.content.tokenCount,
          }
        : undefined,
      inputPreview: formatToolInput(toolInput as Record<string, unknown>),
      outputPreview: resultStep
        ? formatToolResult(resultStep.content.toolResultContent ?? '')
        : undefined,
      startTime: callStartTime,
      endTime: resultStartTime,
      durationMs: resultStartTime ? resultStartTime.getTime() - callStartTime.getTime() : undefined,
      isOrphaned: !resultStep,
      skillInstructions,
      skillInstructionsTokenCount: skillInstructions
        ? estimateTokens(skillInstructions)
        : undefined,
    };

    linkedTools.set(toolCallId, linkedItem);
  }

  return linkedTools;
}
