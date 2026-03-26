/**
 * Tests for contextTracker - processSessionContextWithPhases.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { makeAIChunk, makeCompactChunk, makeUserChunk, resetChunkCounter } from '../../fixtures/chunks';
import { makeAssistantMessage, resetMessageCounter } from '../../fixtures/messages';

import { transformChunksToConversation } from '../../../src/renderer/utils/groupTransformer';
import { processSessionContextWithPhases } from '../../../src/renderer/utils/contextTracker';

import type { EnhancedChunk } from '../../../src/shared/types/chunks';

beforeEach(() => {
  resetChunkCounter();
  resetMessageCounter();
});

function makeConversationItems(chunks: EnhancedChunk[]) {
  const conversation = transformChunksToConversation(chunks, [], false);
  return conversation.items;
}

describe('processSessionContextWithPhases', () => {
  it('returns empty stats for empty items', () => {
    const { statsMap, phaseInfo } = processSessionContextWithPhases([], '/project');
    expect(statsMap.size).toBe(0);
    expect(phaseInfo.phases).toEqual([]);
    expect(phaseInfo.compactionCount).toBe(0);
  });

  it('returns stats for a simple user + AI conversation', () => {
    const chunks = [
      makeUserChunk({}, { content: 'Hello Claude' }),
      makeAIChunk({}, [
        makeAssistantMessage({
          content: [{ type: 'text', text: 'Hello! How can I help?' }],
          usage: { inputTokens: 100, outputTokens: 50 },
        }),
      ]),
    ];
    const items = makeConversationItems(chunks);
    const { statsMap, phaseInfo } = processSessionContextWithPhases(items, '/project');

    // Should have stats for the AI group
    expect(statsMap.size).toBe(1);
    expect(phaseInfo.compactionCount).toBe(0);
    // One phase containing the single AI group
    expect(phaseInfo.phases).toHaveLength(1);
  });

  it('tracks multiple phases separated by compaction events', () => {
    const chunks = [
      makeUserChunk({}, { content: 'First message', timestamp: new Date('2024-01-01T00:00:00Z') }),
      makeAIChunk({}, [
        makeAssistantMessage({
          content: [{ type: 'text', text: 'First response' }],
          usage: { inputTokens: 100, outputTokens: 50 },
          timestamp: new Date('2024-01-01T00:00:01Z'),
        }),
      ]),
      makeCompactChunk({}, { timestamp: new Date('2024-01-01T00:00:02Z') }),
      makeUserChunk({}, { content: 'After compaction', timestamp: new Date('2024-01-01T00:00:03Z') }),
      makeAIChunk({}, [
        makeAssistantMessage({
          content: [{ type: 'text', text: 'Second response' }],
          usage: { inputTokens: 200, outputTokens: 80 },
          timestamp: new Date('2024-01-01T00:00:04Z'),
        }),
      ]),
    ];
    const items = makeConversationItems(chunks);
    const { phaseInfo } = processSessionContextWithPhases(items, '/project');

    expect(phaseInfo.compactionCount).toBe(1);
    // Two phases: before and after compaction
    expect(phaseInfo.phases).toHaveLength(2);
  });

  it('handles multiple compaction events creating 3+ phases', () => {
    const chunks = [
      makeUserChunk({}, { content: 'Phase 1', timestamp: new Date('2024-01-01T00:00:00Z') }),
      makeAIChunk({}, [
        makeAssistantMessage({
          content: [{ type: 'text', text: 'Response 1' }],
          usage: { inputTokens: 100, outputTokens: 50 },
          timestamp: new Date('2024-01-01T00:00:01Z'),
        }),
      ]),
      makeCompactChunk({}, { timestamp: new Date('2024-01-01T00:00:02Z') }),
      makeUserChunk({}, { content: 'Phase 2', timestamp: new Date('2024-01-01T00:00:03Z') }),
      makeAIChunk({}, [
        makeAssistantMessage({
          content: [{ type: 'text', text: 'Response 2' }],
          usage: { inputTokens: 200, outputTokens: 80 },
          timestamp: new Date('2024-01-01T00:00:04Z'),
        }),
      ]),
      makeCompactChunk({}, { timestamp: new Date('2024-01-01T00:00:05Z') }),
      makeUserChunk({}, { content: 'Phase 3', timestamp: new Date('2024-01-01T00:00:06Z') }),
      makeAIChunk({}, [
        makeAssistantMessage({
          content: [{ type: 'text', text: 'Response 3' }],
          usage: { inputTokens: 300, outputTokens: 100 },
          timestamp: new Date('2024-01-01T00:00:07Z'),
        }),
      ]),
    ];
    const items = makeConversationItems(chunks);
    const { phaseInfo } = processSessionContextWithPhases(items, '/project');

    expect(phaseInfo.compactionCount).toBe(2);
    expect(phaseInfo.phases).toHaveLength(3);
  });

  it('computes stats per AI group', () => {
    const chunks = [
      makeUserChunk({}, { content: 'Hello', timestamp: new Date('2024-01-01T00:00:00Z') }),
      makeAIChunk({}, [
        makeAssistantMessage({
          content: [{ type: 'text', text: 'First AI' }],
          usage: { inputTokens: 100, outputTokens: 50 },
          timestamp: new Date('2024-01-01T00:00:01Z'),
        }),
      ]),
      makeUserChunk({}, { content: 'Next', timestamp: new Date('2024-01-01T00:00:02Z') }),
      makeAIChunk({}, [
        makeAssistantMessage({
          content: [{ type: 'text', text: 'Second AI' }],
          usage: { inputTokens: 200, outputTokens: 80 },
          timestamp: new Date('2024-01-01T00:00:03Z'),
        }),
      ]),
    ];
    const items = makeConversationItems(chunks);
    const { statsMap } = processSessionContextWithPhases(items, '/project');

    // Should have stats entries for each AI group
    expect(statsMap.size).toBe(2);
  });

  it('handles conversation with only user messages (no AI groups)', () => {
    const chunks = [
      makeUserChunk({}, { content: 'Hello' }),
    ];
    const items = makeConversationItems(chunks);
    const { statsMap, phaseInfo } = processSessionContextWithPhases(items, '/project');

    expect(statsMap.size).toBe(0);
    expect(phaseInfo.compactionCount).toBe(0);
    expect(phaseInfo.phases).toEqual([]);
  });

  it('maps AI groups to their phase numbers', () => {
    const chunks = [
      makeUserChunk({}, { content: 'Phase 1', timestamp: new Date('2024-01-01T00:00:00Z') }),
      makeAIChunk({}, [
        makeAssistantMessage({
          content: [{ type: 'text', text: 'Response 1' }],
          usage: { inputTokens: 100, outputTokens: 50 },
          timestamp: new Date('2024-01-01T00:00:01Z'),
        }),
      ]),
      makeCompactChunk({}, { timestamp: new Date('2024-01-01T00:00:02Z') }),
      makeUserChunk({}, { content: 'Phase 2', timestamp: new Date('2024-01-01T00:00:03Z') }),
      makeAIChunk({}, [
        makeAssistantMessage({
          content: [{ type: 'text', text: 'Response 2' }],
          usage: { inputTokens: 200, outputTokens: 80 },
          timestamp: new Date('2024-01-01T00:00:04Z'),
        }),
      ]),
    ];
    const items = makeConversationItems(chunks);
    const { phaseInfo } = processSessionContextWithPhases(items, '/project');

    // Each AI group should be mapped to its phase
    expect(phaseInfo.aiGroupPhaseMap.size).toBe(2);
    // First AI group in phase 1, second in phase 2
    const phaseNumbers = Array.from(phaseInfo.aiGroupPhaseMap.values());
    expect(phaseNumbers).toContain(1);
    expect(phaseNumbers).toContain(2);
  });
});
