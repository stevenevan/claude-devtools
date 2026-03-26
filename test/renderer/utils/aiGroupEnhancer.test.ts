/**
 * Tests for aiGroupEnhancer - enhanceAIGroup orchestrator.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { makeAIChunk, makeSemanticStep, makeUserChunk, resetChunkCounter } from '../../fixtures/chunks';
import { makeAssistantMessage, resetMessageCounter } from '../../fixtures/messages';

import { transformChunksToConversation } from '../../../src/renderer/utils/groupTransformer';
import { enhanceAIGroup } from '../../../src/renderer/utils/aiGroupEnhancer';

import type { AIGroup } from '../../../src/renderer/types/groups';

beforeEach(() => {
  resetChunkCounter();
  resetMessageCounter();
});

function getFirstAIGroup(chunks: Parameters<typeof transformChunksToConversation>[0]): AIGroup {
  const conversation = transformChunksToConversation(chunks, [], false);
  const aiItem = conversation.items.find((item) => item.type === 'ai');
  if (!aiItem || aiItem.type !== 'ai') {
    throw new Error('No AI group found');
  }
  return aiItem.group;
}

describe('enhanceAIGroup', () => {
  it('produces an EnhancedAIGroup with all required properties', () => {
    const chunks = [
      makeUserChunk(),
      makeAIChunk({}, [
        makeAssistantMessage({
          content: [{ type: 'text', text: 'Hello! I can help.' }],
          usage: { inputTokens: 100, outputTokens: 50 },
        }),
      ]),
    ];
    const aiGroup = getFirstAIGroup(chunks);
    const enhanced = enhanceAIGroup(aiGroup);

    expect(enhanced.id).toBe(aiGroup.id);
    expect(enhanced.linkedTools).toBeInstanceOf(Map);
    expect(Array.isArray(enhanced.displayItems)).toBe(true);
    expect(typeof enhanced.itemsSummary).toBe('string');
    expect(enhanced.claudeMdStats).toBeNull();
  });

  it('links tool calls to results correctly', () => {
    const chunks = [
      makeUserChunk(),
      makeAIChunk({
        semanticSteps: [
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
            toolResultContent: 'file contents',
            startTime: new Date('2024-01-01T00:00:02Z'),
          }),
        ],
      }),
    ];
    const aiGroup = getFirstAIGroup(chunks);
    const enhanced = enhanceAIGroup(aiGroup);

    expect(enhanced.linkedTools.size).toBe(1);
    expect(enhanced.linkedTools.get('tool-1')).toBeDefined();
    expect(enhanced.linkedTools.get('tool-1')!.isOrphaned).toBe(false);
  });

  it('sets claudeMdStats when provided', () => {
    const chunks = [makeUserChunk(), makeAIChunk()];
    const aiGroup = getFirstAIGroup(chunks);

    const mockStats = {
      accumulatedCount: 2,
      newCount: 1,
      totalEstimatedTokens: 500,
      accumulatedInjections: [],
      newInjections: [],
    };
    const enhanced = enhanceAIGroup(aiGroup, mockStats);

    expect(enhanced.claudeMdStats).toBe(mockStats);
  });

  it('builds display items from semantic steps', () => {
    const chunks = [
      makeUserChunk(),
      makeAIChunk({
        semanticSteps: [
          makeSemanticStep({
            type: 'thinking',
            thinkingText: 'Let me think about this...',
            startTime: new Date('2024-01-01T00:00:01Z'),
          }),
          makeSemanticStep({
            type: 'text',
            outputText: 'Here is my answer.',
            startTime: new Date('2024-01-01T00:00:02Z'),
          }),
        ],
      }),
    ];
    const aiGroup = getFirstAIGroup(chunks);
    const enhanced = enhanceAIGroup(aiGroup);

    expect(enhanced.displayItems.length).toBeGreaterThanOrEqual(1);
  });

  it('handles empty AI group gracefully', () => {
    const chunks = [
      makeUserChunk(),
      makeAIChunk({ semanticSteps: [] }, [
        makeAssistantMessage({
          content: [],
          usage: { inputTokens: 10, outputTokens: 0 },
        }),
      ]),
    ];
    const aiGroup = getFirstAIGroup(chunks);
    const enhanced = enhanceAIGroup(aiGroup);

    expect(enhanced.linkedTools.size).toBe(0);
    expect(enhanced.displayItems).toEqual([]);
  });
});
