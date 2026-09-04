import { describe, expect, test } from 'bun:test';

import { buildSimpleTranscript } from './transcriptSimpleSteps';

import type { InspectorEvent, TranscriptRecord } from '@shared/types/api';

function legacy(overrides: Partial<TranscriptRecord>): TranscriptRecord {
  return {
    kind: 'user',
    timestamp: null,
    content: null,
    toolName: null,
    toolInput: null,
    toolOutput: null,
    truncated: false,
    ...overrides,
  };
}

function inspectorEvent(overrides: Partial<InspectorEvent>): InspectorEvent {
  return {
    kind: 'user_message',
    role: 'user',
    content: null,
    timestamp: null,
    toolName: null,
    toolInputShape: null,
    toolOutputSize: null,
    truncated: false,
    provenance: { sourceFile: 'ses_helper.jsonl', line: 1 },
    ...overrides,
  };
}

describe('simple transcript builder', () => {
  test('pairs helper tool calls with their results and sanitizes user text', () => {
    const transcript = buildSimpleTranscript([
      legacy({
        kind: 'user',
        content: 'Inspect /Users/alice/private/notes.txt with claude-opus-4-6.',
      }),
      legacy({
        kind: 'tool_use',
        toolName: 'Read',
        toolInput: JSON.stringify({ file_path: '/private/project/notes.txt' }),
      }),
      legacy({ kind: 'tool_result', toolName: 'Read', toolOutput: 'contents' }),
      legacy({
        kind: 'tool_use',
        toolName: 'Task',
        toolInput: JSON.stringify({ prompt: 'subagent work' }),
      }),
      legacy({ kind: 'tool_result', toolName: 'Task', toolOutput: 'done' }),
    ]);

    expect(transcript.userTexts.map((entry) => entry.text)).toEqual([
      'Inspect notes.txt with Claude.',
    ]);
    expect(transcript.toolSteps.map((entry) => entry.text)).toEqual([
      'Read notes.txt',
      'Asked a helper for help',
    ]);
    expect(transcript.userTexts.map((entry) => entry.id)).toEqual([
      'simple-transcript-user-0',
    ]);
  });

  test('keeps lone results and skips unknown record kinds', () => {
    const transcript = buildSimpleTranscript([
      legacy({ kind: 'tool_result', toolName: 'Bash', toolOutput: 'ok' }),
      legacy({ kind: 'mystery_kind', content: 'should not appear' }),
      inspectorEvent({ kind: 'system_notice', role: 'system', content: 'hidden' }),
    ]);

    expect(transcript.toolSteps.map((entry) => entry.text)).toEqual([
      'Got a result from Bash',
    ]);
    expect(transcript.userTexts).toEqual([]);
  });

  test('reads inspector events with the same narrative rules', () => {
    const transcript = buildSimpleTranscript([
      inspectorEvent({ content: 'Please help with 123e4567-e89b-12d3-a456-426614174000.' }),
      inspectorEvent({
        kind: 'tool_call',
        role: 'assistant',
        toolName: 'Grep',
        toolInputShape: 'object',
        toolOutputSize: null,
      }),
      inspectorEvent({
        kind: 'tool_result',
        role: 'assistant',
        toolName: 'Grep',
        toolOutputSize: 128,
      }),
    ]);

    expect(transcript.userTexts).toHaveLength(1);
    expect(transcript.userTexts[0]?.text).not.toContain('123e4567');
    expect(transcript.toolSteps.map((entry) => entry.text)).toEqual(['Searched files']);
  });
});
