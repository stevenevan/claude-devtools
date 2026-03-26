/**
 * Test fixture factories for EnhancedChunk types.
 */

import { makeAssistantMessage, makeCompactMessage, makeSystemMessage, makeUserMessage } from './messages';

import type { SessionMetrics } from '../../src/shared/types/domain';
import type { ParsedMessage } from '../../src/shared/types/messages';
import type {
  EnhancedAIChunk,
  EnhancedCompactChunk,
  EnhancedEventChunk,
  EnhancedSystemChunk,
  EnhancedUserChunk,
  SemanticStep,
} from '../../src/shared/types/chunks';

let chunkCounter = 0;

function nextChunkId(): string {
  return `chunk-${++chunkCounter}`;
}

export function resetChunkCounter(): void {
  chunkCounter = 0;
}

function emptyMetrics(): SessionMetrics {
  return {
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalCost: 0,
    messageCount: 0,
    toolCallCount: 0,
  };
}

export function makeUserChunk(
  overrides: Partial<EnhancedUserChunk> = {},
  msgOverrides: Partial<ParsedMessage> = {}
): EnhancedUserChunk {
  const msg = makeUserMessage(msgOverrides);
  return {
    id: nextChunkId(),
    chunkType: 'user',
    startTime: msg.timestamp,
    endTime: msg.timestamp,
    durationMs: 0,
    metrics: emptyMetrics(),
    userMessage: msg,
    rawMessages: [msg],
    ...overrides,
  };
}

export function makeAIChunk(
  overrides: Partial<EnhancedAIChunk> = {},
  messages?: ParsedMessage[]
): EnhancedAIChunk {
  const msgs = messages ?? [makeAssistantMessage()];
  const start = msgs[0]?.timestamp ?? new Date('2024-01-01T00:00:01Z');
  const end = msgs[msgs.length - 1]?.timestamp ?? start;
  return {
    id: nextChunkId(),
    chunkType: 'ai',
    startTime: start,
    endTime: end,
    durationMs: end.getTime() - start.getTime(),
    metrics: {
      ...emptyMetrics(),
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      messageCount: msgs.length,
    },
    responses: msgs,
    processes: [],
    sidechainMessages: [],
    toolExecutions: [],
    semanticSteps: [],
    rawMessages: msgs,
    ...overrides,
  };
}

export function makeSystemChunk(
  overrides: Partial<EnhancedSystemChunk> = {},
  msgOverrides: Partial<ParsedMessage> = {}
): EnhancedSystemChunk {
  const msg = makeSystemMessage(msgOverrides);
  return {
    id: nextChunkId(),
    chunkType: 'system',
    startTime: msg.timestamp,
    endTime: msg.timestamp,
    durationMs: 0,
    metrics: emptyMetrics(),
    message: msg,
    commandOutput: 'output here',
    rawMessages: [msg],
    ...overrides,
  };
}

export function makeCompactChunk(
  overrides: Partial<EnhancedCompactChunk> = {},
  msgOverrides: Partial<ParsedMessage> = {}
): EnhancedCompactChunk {
  const msg = makeCompactMessage(msgOverrides);
  return {
    id: nextChunkId(),
    chunkType: 'compact',
    startTime: msg.timestamp,
    endTime: msg.timestamp,
    durationMs: 0,
    metrics: emptyMetrics(),
    message: msg,
    rawMessages: [msg],
    ...overrides,
  };
}

export function makeEventChunk(
  overrides: Partial<EnhancedEventChunk> = {}
): EnhancedEventChunk {
  const msg = makeSystemMessage({ type: 'system', subtype: 'api_error' });
  return {
    id: nextChunkId(),
    chunkType: 'event',
    startTime: msg.timestamp,
    endTime: msg.timestamp,
    durationMs: 0,
    metrics: emptyMetrics(),
    message: msg,
    eventData: { type: 'api_error', message: 'Rate limit exceeded' },
    rawMessages: [msg],
    ...overrides,
  };
}

export function makeSemanticStep(overrides: Partial<SemanticStep> & { type?: string; toolName?: string; toolInput?: unknown; toolResultContent?: string; isError?: boolean; outputText?: string; thinkingText?: string } = {}): SemanticStep {
  const { toolName, toolInput, toolResultContent, isError, outputText, thinkingText, ...rest } = overrides;
  return {
    id: `step-${++chunkCounter}`,
    type: 'text',
    startTime: new Date('2024-01-01T00:00:01Z'),
    durationMs: 100,
    content: {
      toolName,
      toolInput,
      toolResultContent,
      isError,
      outputText,
      thinkingText,
    },
    context: 'main',
    ...rest,
  } as SemanticStep;
}
