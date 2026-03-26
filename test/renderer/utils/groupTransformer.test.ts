/**
 * Tests for groupTransformer - transformChunksToConversation and extractFileReferences.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { makeAIChunk, makeCompactChunk, makeSystemChunk, makeUserChunk, resetChunkCounter } from '../../fixtures/chunks';
import { makeAssistantMessage, resetMessageCounter } from '../../fixtures/messages';

import { extractFileReferences, transformChunksToConversation } from '../../../src/renderer/utils/groupTransformer';

beforeEach(() => {
  resetChunkCounter();
  resetMessageCounter();
});

describe('transformChunksToConversation', () => {
  it('returns empty conversation for empty chunks', () => {
    const result = transformChunksToConversation([], [], false);
    expect(result.items).toEqual([]);
    expect(result.totalUserGroups).toBe(0);
    expect(result.totalAIGroups).toBe(0);
    expect(result.totalSystemGroups).toBe(0);
    expect(result.totalCompactGroups).toBe(0);
    expect(result.totalEventGroups).toBe(0);
  });

  it('transforms a single user chunk into a UserGroup item', () => {
    const userChunk = makeUserChunk({}, { content: 'Hello Claude' });
    const result = transformChunksToConversation([userChunk], [], false);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].type).toBe('user');
    expect(result.totalUserGroups).toBe(1);
  });

  it('transforms a single AI chunk into an AIGroup item', () => {
    const aiChunk = makeAIChunk();
    const result = transformChunksToConversation([aiChunk], [], false);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].type).toBe('ai');
    expect(result.totalAIGroups).toBe(1);
  });

  it('transforms a system chunk into a SystemGroup item', () => {
    const sysChunk = makeSystemChunk();
    const result = transformChunksToConversation([sysChunk], [], false);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].type).toBe('system');
    expect(result.totalSystemGroups).toBe(1);
  });

  it('transforms a compact chunk into a CompactGroup item', () => {
    const compactChunk = makeCompactChunk();
    const result = transformChunksToConversation([compactChunk], [], false);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].type).toBe('compact');
    expect(result.totalCompactGroups).toBe(1);
  });

  it('handles mixed chunk types in order', () => {
    const chunks = [
      makeUserChunk(),
      makeAIChunk(),
      makeUserChunk(),
      makeAIChunk(),
      makeSystemChunk(),
    ];
    const result = transformChunksToConversation(chunks, [], false);

    expect(result.items).toHaveLength(5);
    expect(result.items[0].type).toBe('user');
    expect(result.items[1].type).toBe('ai');
    expect(result.items[2].type).toBe('user');
    expect(result.items[3].type).toBe('ai');
    expect(result.items[4].type).toBe('system');
    expect(result.totalUserGroups).toBe(2);
    expect(result.totalAIGroups).toBe(2);
    expect(result.totalSystemGroups).toBe(1);
  });

  it('marks the last AI group as ongoing when isOngoing is true', () => {
    const chunks = [
      makeUserChunk(),
      makeAIChunk(),
      makeUserChunk(),
      makeAIChunk(),
    ];
    const result = transformChunksToConversation(chunks, [], true);

    const aiItems = result.items.filter((item) => item.type === 'ai');
    expect(aiItems).toHaveLength(2);
    // Last AI group should be marked as ongoing
    const lastAI = aiItems[aiItems.length - 1];
    if (lastAI.type === 'ai') {
      expect(lastAI.group.isOngoing).toBe(true);
    }
    // First AI group should NOT be marked as ongoing
    const firstAI = aiItems[0];
    if (firstAI.type === 'ai') {
      expect(firstAI.group.isOngoing).toBeFalsy();
    }
  });

  it('does not mark any AI group as ongoing when isOngoing is false', () => {
    const chunks = [makeUserChunk(), makeAIChunk()];
    const result = transformChunksToConversation(chunks, [], false);

    const aiItem = result.items.find((item) => item.type === 'ai');
    if (aiItem?.type === 'ai') {
      expect(aiItem.group.isOngoing).toBeFalsy();
    }
  });

  it('assigns sequential turnIndex to AI groups', () => {
    const chunks = [
      makeUserChunk(),
      makeAIChunk(),
      makeUserChunk(),
      makeAIChunk(),
      makeUserChunk(),
      makeAIChunk(),
    ];
    const result = transformChunksToConversation(chunks, [], false);

    const aiItems = result.items.filter((item) => item.type === 'ai');
    aiItems.forEach((item, index) => {
      if (item.type === 'ai') {
        expect(item.group.turnIndex).toBe(index);
      }
    });
  });

  it('creates unique IDs for each group', () => {
    const chunks = [
      makeUserChunk(),
      makeAIChunk(),
      makeUserChunk(),
      makeAIChunk(),
    ];
    const result = transformChunksToConversation(chunks, [], false);

    const ids = result.items.map((item) => {
      if (item.type === 'user') return item.group.id;
      if (item.type === 'ai') return item.group.id;
      return '';
    });
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('handles AI chunk with multiple assistant messages', () => {
    const msgs = [
      makeAssistantMessage({ content: [{ type: 'text', text: 'First response' }] }),
      makeAssistantMessage({
        content: [{ type: 'text', text: 'Second response' }],
        timestamp: new Date('2024-01-01T00:00:02Z'),
      }),
    ];
    const aiChunk = makeAIChunk({}, msgs);
    const result = transformChunksToConversation([aiChunk], [], false);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].type).toBe('ai');
    if (result.items[0].type === 'ai') {
      expect(result.items[0].group.responses.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('extractFileReferences', () => {
  it('returns empty array for empty text', () => {
    expect(extractFileReferences('')).toEqual([]);
  });

  it('extracts simple file reference', () => {
    const refs = extractFileReferences('Look at @src/index.ts for details');
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0].path).toContain('src/index.ts');
  });

  it('extracts multiple file references', () => {
    const refs = extractFileReferences('See @src/a.ts and @src/b.ts');
    expect(refs.length).toBeGreaterThanOrEqual(2);
  });

  it('returns empty for text without file references', () => {
    const refs = extractFileReferences('No files here, just plain text.');
    expect(refs).toEqual([]);
  });
});
