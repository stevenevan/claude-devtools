/**
 * Tests for toolLinkingEngine - linking tool calls to their results.
 */

import { describe, it, expect } from 'vitest';

import { makeSemanticStep } from '../../fixtures/chunks';

import { linkToolCallsToResults } from '../../../src/renderer/utils/toolLinkingEngine';

import type { SemanticStep } from '../../../src/shared/types/chunks';

describe('linkToolCallsToResults', () => {
  it('returns empty map for no steps', () => {
    const result = linkToolCallsToResults([]);
    expect(result.size).toBe(0);
  });

  it('returns empty map for steps without tool calls', () => {
    const steps: SemanticStep[] = [
      makeSemanticStep({ type: 'text', outputText: 'Hello' }),
      makeSemanticStep({ type: 'thinking', thinkingText: 'Thinking...' }),
    ];
    const result = linkToolCallsToResults(steps);
    expect(result.size).toBe(0);
  });

  it('links a tool call to its result by ID', () => {
    const steps: SemanticStep[] = [
      makeSemanticStep({
        id: 'tool-1',
        type: 'tool_call',
        toolName: 'Read',
        toolInput: { file_path: '/test.ts' },
        startTime: new Date('2024-01-01T00:00:01Z'),
      }),
      makeSemanticStep({
        id: 'tool-1',
        type: 'tool_result',
        toolName: 'Read',
        toolResultContent: 'File contents here',
        startTime: new Date('2024-01-01T00:00:02Z'),
      }),
    ];
    const result = linkToolCallsToResults(steps);

    expect(result.size).toBe(1);
    const linked = result.get('tool-1');
    expect(linked).toBeDefined();
    expect(linked!.name).toBe('Read');
    expect(linked!.isOrphaned).toBe(false);
    expect(linked!.result).toBeDefined();
  });

  it('marks tool call as orphaned when no result exists', () => {
    const steps: SemanticStep[] = [
      makeSemanticStep({
        id: 'tool-1',
        type: 'tool_call',
        toolName: 'Bash',
        toolInput: { command: 'ls' },
        startTime: new Date('2024-01-01T00:00:01Z'),
      }),
    ];
    const result = linkToolCallsToResults(steps);

    expect(result.size).toBe(1);
    const linked = result.get('tool-1');
    expect(linked).toBeDefined();
    expect(linked!.isOrphaned).toBe(true);
    expect(linked!.result).toBeUndefined();
  });

  it('handles multiple tool calls with matching results', () => {
    const steps: SemanticStep[] = [
      makeSemanticStep({
        id: 'tool-1',
        type: 'tool_call',
        toolName: 'Read',
        toolInput: {},
        startTime: new Date('2024-01-01T00:00:01Z'),
      }),
      makeSemanticStep({
        id: 'tool-2',
        type: 'tool_call',
        toolName: 'Bash',
        toolInput: {},
        startTime: new Date('2024-01-01T00:00:02Z'),
      }),
      makeSemanticStep({
        id: 'tool-1',
        type: 'tool_result',
        toolName: 'Read',
        toolResultContent: 'file content',
        startTime: new Date('2024-01-01T00:00:03Z'),
      }),
      makeSemanticStep({
        id: 'tool-2',
        type: 'tool_result',
        toolName: 'Bash',
        toolResultContent: 'command output',
        startTime: new Date('2024-01-01T00:00:04Z'),
      }),
    ];
    const result = linkToolCallsToResults(steps);

    expect(result.size).toBe(2);
    expect(result.get('tool-1')!.isOrphaned).toBe(false);
    expect(result.get('tool-2')!.isOrphaned).toBe(false);
  });

  it('handles mixed matched and orphaned tool calls', () => {
    const steps: SemanticStep[] = [
      makeSemanticStep({
        id: 'tool-1',
        type: 'tool_call',
        toolName: 'Read',
        toolInput: {},
        startTime: new Date('2024-01-01T00:00:01Z'),
      }),
      makeSemanticStep({
        id: 'tool-2',
        type: 'tool_call',
        toolName: 'Write',
        toolInput: {},
        startTime: new Date('2024-01-01T00:00:02Z'),
      }),
      makeSemanticStep({
        id: 'tool-1',
        type: 'tool_result',
        toolName: 'Read',
        toolResultContent: 'result',
        startTime: new Date('2024-01-01T00:00:03Z'),
      }),
      // No result for tool-2
    ];
    const result = linkToolCallsToResults(steps);

    expect(result.size).toBe(2);
    expect(result.get('tool-1')!.isOrphaned).toBe(false);
    expect(result.get('tool-2')!.isOrphaned).toBe(true);
  });
});
