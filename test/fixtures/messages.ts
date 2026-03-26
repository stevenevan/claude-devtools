/**
 * Test fixture factories for ParsedMessage and related types.
 */

import type { ParsedMessage } from '../../src/shared/types/messages';

let counter = 0;

function nextId(): string {
  return `msg-${++counter}`;
}

export function resetMessageCounter(): void {
  counter = 0;
}

export function makeUserMessage(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  const id = nextId();
  return {
    uuid: id,
    parentUuid: null,
    type: 'user',
    timestamp: new Date('2024-01-01T00:00:00Z'),
    role: 'user',
    content: 'Hello, world!',
    isSidechain: false,
    isMeta: false,
    toolCalls: [],
    toolResults: [],
    ...overrides,
  };
}

export function makeAssistantMessage(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  const id = nextId();
  return {
    uuid: id,
    parentUuid: null,
    type: 'assistant',
    timestamp: new Date('2024-01-01T00:00:01Z'),
    role: 'assistant',
    content: [{ type: 'text', text: 'I can help with that.' }],
    usage: { inputTokens: 100, outputTokens: 50 },
    model: 'claude-sonnet-4-20250514',
    isSidechain: false,
    isMeta: false,
    toolCalls: [],
    toolResults: [],
    ...overrides,
  };
}

export function makeToolCallMessage(
  toolName: string,
  toolId: string,
  overrides: Partial<ParsedMessage> = {}
): ParsedMessage {
  const id = nextId();
  return {
    uuid: id,
    parentUuid: null,
    type: 'assistant',
    timestamp: new Date('2024-01-01T00:00:02Z'),
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: toolId,
        name: toolName,
        input: { command: 'ls' },
      },
    ],
    usage: { inputTokens: 100, outputTokens: 30 },
    model: 'claude-sonnet-4-20250514',
    isSidechain: false,
    isMeta: false,
    toolCalls: [
      {
        id: toolId,
        name: toolName,
        input: { command: 'ls' },
      },
    ],
    toolResults: [],
    ...overrides,
  };
}

export function makeToolResultMessage(
  toolId: string,
  content: string,
  overrides: Partial<ParsedMessage> = {}
): ParsedMessage {
  const id = nextId();
  return {
    uuid: id,
    parentUuid: null,
    type: 'user',
    timestamp: new Date('2024-01-01T00:00:03Z'),
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: toolId,
        content,
      },
    ],
    isSidechain: false,
    isMeta: true,
    toolCalls: [],
    toolResults: [
      {
        toolUseId: toolId,
        content,
        isError: false,
      },
    ],
    ...overrides,
  };
}

export function makeSystemMessage(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  const id = nextId();
  return {
    uuid: id,
    parentUuid: null,
    type: 'system',
    timestamp: new Date('2024-01-01T00:00:04Z'),
    content: '<local-command-stdout>output here</local-command-stdout>',
    isSidechain: false,
    isMeta: false,
    toolCalls: [],
    toolResults: [],
    ...overrides,
  };
}

export function makeCompactMessage(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  const id = nextId();
  return {
    uuid: id,
    parentUuid: null,
    type: 'assistant',
    timestamp: new Date('2024-01-01T00:00:05Z'),
    role: 'assistant',
    content: 'Conversation compacted.',
    isCompactSummary: true,
    isSidechain: false,
    isMeta: false,
    toolCalls: [],
    toolResults: [],
    ...overrides,
  };
}
