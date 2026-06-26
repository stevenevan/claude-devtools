import { isAssistantMessage } from '@renderer/types/data';

import type { EnhancedAIChunk, ParsedMessage, SemanticStep } from '@renderer/types/data';
import type { AIGroup, AIGroupStatus, AIGroupSummary, AIGroupTokens } from '@renderer/types/groups';

const THINKING_PREVIEW_LENGTH = 100;

export function createAIGroupFromChunk(chunk: EnhancedAIChunk, turnIndex: number): AIGroup {
  const steps = chunk.semanticSteps;

  const startTime = steps.length > 0 ? steps[0].startTime : chunk.startTime;
  const endTime =
    steps.length > 0
      ? (steps[steps.length - 1].endTime ?? steps[steps.length - 1].startTime)
      : chunk.endTime;
  const durationMs = endTime.getTime() - startTime.getTime();

  const sourceMessage = chunk.responses.find((msg) => isAssistantMessage(msg)) ?? null;
  const tokens = calculateTokensFromSteps(steps, sourceMessage);
  const summary = computeAIGroupSummary(steps);
  const status = determineAIGroupStatus(steps);

  return {
    id: chunk.id,
    turnIndex,
    startTime,
    endTime,
    durationMs,
    steps,
    tokens,
    summary,
    status,
    processes: chunk.processes,
    chunkId: chunk.id,
    metrics: chunk.metrics,
    responses: chunk.responses,
    progressCount: chunk.progressCount,
    progressTexts: chunk.progressTexts,
  };
}

function calculateTokensFromSteps(
  steps: SemanticStep[],
  sourceMessage: ParsedMessage | null | undefined
): AIGroupTokens {
  let input = 0;
  let output = 0;
  let cached = 0;
  let thinking = 0;

  for (const step of steps) {
    if (step.tokens) {
      input += step.tokens.input ?? 0;
      output += step.tokens.output ?? 0;
      cached += step.tokens.cached ?? 0;
    }
    if (step.tokenBreakdown) {
      input += step.tokenBreakdown.input ?? 0;
      output += step.tokenBreakdown.output ?? 0;
      cached += step.tokenBreakdown.cacheRead ?? 0;
    }
    if (step.type === 'thinking' && step.tokens?.output) {
      thinking += step.tokens.output;
    }
  }

  if (sourceMessage?.usage) {
    input = sourceMessage.usage.input_tokens ?? 0;
    output = sourceMessage.usage.output_tokens ?? 0;
    cached = sourceMessage.usage.cache_read_input_tokens ?? 0;
  }

  return { input, output, cached, thinking };
}

function computeAIGroupSummary(steps: SemanticStep[]): AIGroupSummary {
  let thinkingPreview: string | undefined;
  let toolCallCount = 0;
  let outputMessageCount = 0;
  let subagentCount = 0;
  let totalDurationMs = 0;
  let totalTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;

  for (const step of steps) {
    if (!thinkingPreview && step.type === 'thinking' && step.content.thinkingText) {
      const fullText = step.content.thinkingText;
      thinkingPreview =
        fullText.length > THINKING_PREVIEW_LENGTH
          ? fullText.slice(0, THINKING_PREVIEW_LENGTH) + '...'
          : fullText;
    }

    if (step.type === 'tool_call') toolCallCount++;
    if (step.type === 'output') outputMessageCount++;
    if (step.type === 'subagent') subagentCount++;

    totalDurationMs += step.durationMs ?? 0;

    if (step.tokens) {
      totalTokens += (step.tokens.input ?? 0) + (step.tokens.output ?? 0);
      outputTokens += step.tokens.output ?? 0;
      cachedTokens += step.tokens.cached ?? 0;
    }
    if (step.tokenBreakdown) {
      totalTokens += step.tokenBreakdown.input + step.tokenBreakdown.output;
      outputTokens += step.tokenBreakdown.output;
      cachedTokens += step.tokenBreakdown.cacheRead;
    }
  }

  return {
    thinkingPreview,
    toolCallCount,
    outputMessageCount,
    subagentCount,
    totalDurationMs,
    totalTokens,
    outputTokens,
    cachedTokens,
  };
}

function determineAIGroupStatus(steps: SemanticStep[]): AIGroupStatus {
  if (steps.length === 0) return 'error';
  if (steps.some((step) => step.type === 'interruption')) return 'interrupted';
  if (steps.some((step) => step.type === 'tool_result' && step.content.isError)) return 'error';
  if (steps.some((step) => !step.endTime)) return 'in_progress';
  return 'complete';
}

export function getLastAssistantTotalTokens(aiGroup: AIGroup): number | undefined {
  const responses = aiGroup.responses || [];
  for (let i = responses.length - 1; i >= 0; i--) {
    const msg = responses[i];
    if (msg.type === 'assistant' && msg.usage) {
      return (
        (msg.usage.input_tokens ?? 0) +
        (msg.usage.output_tokens ?? 0) +
        (msg.usage.cache_read_input_tokens ?? 0) +
        (msg.usage.cache_creation_input_tokens ?? 0)
      );
    }
  }
  return undefined;
}

export function getFirstAssistantTotalTokens(aiGroup: AIGroup): number | undefined {
  const responses = aiGroup.responses || [];
  for (const msg of responses) {
    if (msg.type === 'assistant' && msg.usage) {
      return (
        (msg.usage.input_tokens ?? 0) +
        (msg.usage.output_tokens ?? 0) +
        (msg.usage.cache_read_input_tokens ?? 0) +
        (msg.usage.cache_creation_input_tokens ?? 0)
      );
    }
  }
  return undefined;
}
