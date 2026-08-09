import { expect, test } from 'bun:test';

import { getChatItemKey } from './ChatHistoryVirtualizer';
import { createSimpleConversation } from './simpleChat';
import { formatConversationSubject } from '../dashboard/dashboardFormatters';

import type {
  AIGroup,
  ChatItem,
  SessionConversation,
  UserGroup,
} from '@renderer/types/groups';
import type { ParsedMessage, Process, SemanticStep, SessionMetrics } from '@shared/types';

const timestamp = new Date('2026-08-09T12:00:00.000Z');

const metrics: SessionMetrics = {
  durationMs: 0,
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  messageCount: 0,
};

function message(type: ParsedMessage['type'], uuid: string): ParsedMessage {
  return {
    uuid,
    parentUuid: null,
    type,
    timestamp,
    content: '',
    isSidechain: false,
    isMeta: false,
    toolCalls: [],
    toolResults: [],
  };
}

function step(
  id: string,
  type: SemanticStep['type'],
  content: SemanticStep['content']
): SemanticStep {
  return {
    id,
    type,
    startTime: timestamp,
    durationMs: 0,
    content,
    context: 'main',
  };
}

function process(): Process {
  return {
    id: 'helper-1',
    filePath: '/private/project/helper.jsonl',
    messages: [],
    startTime: timestamp,
    endTime: timestamp,
    durationMs: 0,
    metrics,
    description: 'Inspect project files',
    isParallel: false,
    parentTaskId: 'task-1',
  };
}

function aiGroup(): AIGroup {
  return {
    id: 'assistant-turn-1',
    turnIndex: 4,
    startTime: timestamp,
    endTime: timestamp,
    durationMs: 0,
    steps: [
      step('thinking-1', 'thinking', { thinkingText: 'Internal reasoning' }),
      step('read-1', 'tool_call', {
        toolName: 'Read',
        toolInput: { file_path: '/private/project/notes.txt' },
      }),
      step('bash-1', 'tool_call', {
        toolName: 'Bash',
        toolInput: { command: 'cat /private/project/notes.txt' },
      }),
      step('task-1', 'tool_call', {
        toolName: 'Task',
        toolInput: { prompt: 'Inspect /private/project/notes.txt' },
      }),
      step('subagent-1', 'subagent', { subagentId: 'helper-1' }),
      step('output-1', 'output', { outputText: 'Finished the requested work.' }),
    ],
    tokens: { input: 0, output: 0, cached: 0 },
    summary: {
      toolCallCount: 3,
      outputMessageCount: 1,
      subagentCount: 1,
      totalDurationMs: 0,
      totalTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
    },
    status: 'complete',
    processes: [process()],
    chunkId: 'chunk-1',
    metrics,
    responses: [],
  };
}

function userGroup(): UserGroup {
  return {
    id: 'user-turn-1',
    message: message('user', 'user-message-1'),
    timestamp,
    content: { text: 'Please inspect the notes.', commands: [], images: [], fileReferences: [] },
    index: 0,
  };
}

function conversation(): SessionConversation {
  const items: ChatItem[] = [
    { type: 'user', group: userGroup() },
    { type: 'system', group: { id: 'system-1', message: message('system', 'system-message-1'), timestamp, commandOutput: 'technical output' } },
    { type: 'ai', group: aiGroup() },
    {
      type: 'event',
      group: {
        id: 'event-1',
        message: message('system', 'event-message-1'),
        timestamp,
        eventData: { subtype: 'api_error' },
      },
    },
    {
      type: 'compact',
      group: { id: 'compact-1', timestamp, message: message('summary', 'summary-message-1') },
    },
  ];

  return {
    sessionId: 'session-1',
    items,
    totalUserGroups: 1,
    totalSystemGroups: 1,
    totalAIGroups: 1,
    totalCompactGroups: 1,
    totalEventGroups: 1,
  };
}

test('SimpleChat derives stable source-based IDs without mutating Nerd input', () => {
  const source = conversation();
  const before = structuredClone(source);

  const simple = createSimpleConversation(source);
  const repeated = createSimpleConversation(source);

  expect(simple?.items.map((item) => item.id)).toEqual([
    'simple-user-user-turn-1',
    'simple-claude-assistant-turn-1',
    'simple-compaction-compact-1',
  ]);
  expect(repeated?.items.map((item) => item.id)).toEqual(simple?.items.map((item) => item.id));
  expect(source).toEqual(before);
});

test('SimpleChat creates one aggregate StepSummary and omits technical top-level items', () => {
  const simple = createSimpleConversation(conversation());
  const assistant = simple?.items.find((item) => item.type === 'ai');

  expect(assistant?.stepSummary).toEqual({
    id: 'simple-steps-assistant-turn-1',
    steps: [
      { id: 'simple-step-assistant-turn-1-read-1', text: 'Read notes.txt' },
      { id: 'simple-step-assistant-turn-1-bash-1', text: 'Ran a command' },
      { id: 'simple-step-assistant-turn-1-helper-1', text: 'Asked a helper for help' },
    ],
  });
  expect(simple?.items.map((item) => item.type)).toEqual(['user', 'ai', 'compact']);
  expect(assistant).not.toHaveProperty('steps');
  expect(assistant?.content).toBe('Finished the requested work.');
});

test('SimpleChat keeps compaction as a fixed status separator', () => {
  const simple = createSimpleConversation(conversation());
  const compact = simple?.items.find((item) => item.type === 'compact');

  expect(compact?.content).toBe('Older messages were summarised to save space');
});

test('SimpleChat derives stable virtualizer keys from source group IDs', () => {
  const source = conversation();
  const simple = createSimpleConversation(source);
  const repeated = createSimpleConversation(source);

  expect(simple).not.toBeNull();
  expect(repeated).not.toBeNull();
  if (!simple || !repeated) return;

  expect(simple.items.map(getChatItemKey)).toEqual([
    'simple-user-user-turn-1',
    'simple-claude-assistant-turn-1',
    'simple-compaction-compact-1',
  ]);
  expect(repeated.items.map(getChatItemKey)).toEqual(simple.items.map(getChatItemKey));
  expect(simple.items).not.toBe(source.items);
});

test('SimpleChat redacts private session vocabulary from Simple content and subjects', () => {
  const source = conversation();
  const user = source.items.find((item) => item.type === 'user');
  const assistant = source.items.find((item) => item.type === 'ai');
  if (!user || user.type !== 'user' || !assistant || assistant.type !== 'ai') {
    throw new Error('Expected user and assistant items');
  }

  user.group.content.rawText =
    'Read /Users/alice/private/session.jsonl with claude-opus-4-6, 12,345 tokens, and 123e4567-e89b-12d3-a456-426614174000.';
  assistant.group.steps = [
    step('output-private', 'output', {
      outputText:
        'Saved C:\\workspace\\secret.jsonl for claude-sonnet-4-5 after 900 output tokens and 123e4567-e89b-12d3-a456-426614174000.',
    }),
  ];

  const simple = createSimpleConversation(source);
  const simpleUser = simple?.items.find((item) => item.type === 'user');
  const simpleAssistant = simple?.items.find((item) => item.type === 'ai');
  const customTitle = formatConversationSubject({
    customTitle: 'Review /Users/alice/private/plan.jsonl with claude-3-5-sonnet',
  });
  const firstMessage = formatConversationSubject({
    firstMessage: 'Open C:\\workspace\\first.jsonl after 42 tokens',
  });

  expect(simpleUser?.content).toContain('session file');
  expect(simpleUser?.content).not.toContain('/Users/alice');
  expect(simpleUser?.content).not.toContain('claude-opus-4-6');
  expect(simpleUser?.content).not.toContain('12,345 tokens');
  expect(simpleAssistant?.content).toContain('session file');
  expect(simpleAssistant?.content).not.toContain('C:\\workspace');
  expect(simpleAssistant?.content).not.toContain('claude-sonnet-4-5');
  expect(customTitle).toBe('Review session file with Claude');
  expect(firstMessage).toBe('Open session file after usage details');
});

test('SimpleChat never exposes plan content', () => {
  const source = conversation();
  const assistant = source.items.find((item) => item.type === 'ai');
  if (!assistant || assistant.type !== 'ai') throw new Error('Expected assistant item');

  assistant.group.steps = [
    step('plan-private', 'tool_call', {
      toolName: 'ExitPlanMode',
      toolInput: {
        plan: 'Read /Users/alice/private/plan.jsonl with claude-opus-4-6 and 123 tokens.',
      },
    }),
  ];

  const simple = createSimpleConversation(source);
  const simpleAssistant = simple?.items.find((item) => item.type === 'ai');

  expect(simpleAssistant?.content).toBe('Claude prepared a plan.');
  expect(simpleAssistant?.content).not.toContain('plan.jsonl');
});
