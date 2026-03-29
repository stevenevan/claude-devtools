/**
 * Tests for navigation/utils.ts — findAIGroupBySubagentId, findAIGroupByTimestamp, findChatItemByTimestamp.
 */

import { describe, expect, it } from 'vitest';

import {
  findAIGroupBySubagentId,
  findAIGroupByTimestamp,
  findChatItemByTimestamp,
} from '@renderer/hooks/navigation/utils';

import type { ChatItem } from '@renderer/types/groups';
import type { Process } from '@shared/types';

/** Minimal AI chat item factory for testing. */
function makeAIChatItem(
  groupId: string,
  startMs: number,
  endMs: number,
  processes: Partial<Process>[] = []
): ChatItem {
  return {
    type: 'ai',
    group: {
      id: groupId,
      startTime: new Date(startMs),
      endTime: new Date(endMs),
      processes: processes.map((p) => ({
        id: p.id ?? 'unknown',
        filePath: p.filePath ?? '',
        messages: [],
        startTime: new Date(startMs),
        endTime: new Date(endMs),
        ...p,
      })) as Process[],
    },
  } as ChatItem;
}

function makeUserChatItem(groupId: string, timestampMs: number): ChatItem {
  return {
    type: 'user',
    group: {
      id: groupId,
      timestamp: new Date(timestampMs),
    },
  } as ChatItem;
}

function makeSystemChatItem(groupId: string, timestampMs: number): ChatItem {
  return {
    type: 'system',
    group: {
      id: groupId,
      timestamp: new Date(timestampMs),
    },
  } as ChatItem;
}

function makeCompactChatItem(groupId: string, timestampMs: number): ChatItem {
  return {
    type: 'compact',
    group: {
      id: groupId,
      timestamp: new Date(timestampMs),
    },
  } as ChatItem;
}

// =========================================================================
// findAIGroupBySubagentId
// =========================================================================

describe('findAIGroupBySubagentId', () => {
  it('returns null for empty items', () => {
    expect(findAIGroupBySubagentId([], 'agent-123')).toBeNull();
  });

  it('returns null when no AI group contains the subagent', () => {
    const items: ChatItem[] = [
      makeAIChatItem('ai-1', 0, 1000, [{ id: 'agent-aaa' }]),
      makeAIChatItem('ai-2', 1000, 2000, [{ id: 'agent-bbb' }]),
    ];
    expect(findAIGroupBySubagentId(items, 'agent-ccc')).toBeNull();
  });

  it('finds the AI group containing the subagent', () => {
    const items: ChatItem[] = [
      makeAIChatItem('ai-1', 0, 1000, [{ id: 'agent-aaa' }]),
      makeAIChatItem('ai-2', 1000, 2000, [{ id: 'agent-bbb' }, { id: 'agent-ccc' }]),
    ];
    expect(findAIGroupBySubagentId(items, 'agent-ccc')).toBe('ai-2');
  });

  it('returns first match when subagent appears in multiple groups', () => {
    const items: ChatItem[] = [
      makeAIChatItem('ai-1', 0, 1000, [{ id: 'agent-same' }]),
      makeAIChatItem('ai-2', 1000, 2000, [{ id: 'agent-same' }]),
    ];
    expect(findAIGroupBySubagentId(items, 'agent-same')).toBe('ai-1');
  });

  it('skips non-AI items', () => {
    const items: ChatItem[] = [
      makeUserChatItem('user-1', 0),
      makeAIChatItem('ai-1', 0, 1000, [{ id: 'agent-target' }]),
    ];
    expect(findAIGroupBySubagentId(items, 'agent-target')).toBe('ai-1');
  });
});

// =========================================================================
// findAIGroupByTimestamp
// =========================================================================

describe('findAIGroupByTimestamp', () => {
  it('returns null for empty items', () => {
    expect(findAIGroupByTimestamp([], 5000)).toBeNull();
  });

  it('returns exact match when timestamp is within range', () => {
    const items: ChatItem[] = [
      makeAIChatItem('ai-1', 1000, 3000),
      makeAIChatItem('ai-2', 4000, 6000),
    ];
    expect(findAIGroupByTimestamp(items, 2000)).toBe('ai-1');
    expect(findAIGroupByTimestamp(items, 5000)).toBe('ai-2');
  });

  it('returns closest group when timestamp is outside all ranges', () => {
    const items: ChatItem[] = [
      makeAIChatItem('ai-1', 1000, 2000),
      makeAIChatItem('ai-2', 5000, 6000),
    ];
    // 3000 is closer to ai-1's end (2000, diff=1000) than ai-2's start (5000, diff=2000)
    expect(findAIGroupByTimestamp(items, 3000)).toBe('ai-1');
  });

  it('skips non-AI items when finding closest', () => {
    const items: ChatItem[] = [
      makeUserChatItem('user-1', 0),
      makeAIChatItem('ai-1', 1000, 2000),
    ];
    expect(findAIGroupByTimestamp(items, 1500)).toBe('ai-1');
  });

  it('handles timestamp at exact boundary', () => {
    const items: ChatItem[] = [makeAIChatItem('ai-1', 1000, 2000)];
    expect(findAIGroupByTimestamp(items, 1000)).toBe('ai-1'); // start boundary
    expect(findAIGroupByTimestamp(items, 2000)).toBe('ai-1'); // end boundary
  });
});

// =========================================================================
// findChatItemByTimestamp
// =========================================================================

describe('findChatItemByTimestamp', () => {
  it('returns null for empty items', () => {
    expect(findChatItemByTimestamp([], 5000)).toBeNull();
  });

  it('finds exact AI group match', () => {
    const items: ChatItem[] = [
      makeUserChatItem('user-1', 0),
      makeAIChatItem('ai-1', 1000, 3000),
    ];
    const result = findChatItemByTimestamp(items, 2000);
    expect(result).toEqual({ groupId: 'ai-1', type: 'ai' });
  });

  it('finds closest user item', () => {
    const items: ChatItem[] = [
      makeUserChatItem('user-1', 1000),
      makeUserChatItem('user-2', 5000),
    ];
    const result = findChatItemByTimestamp(items, 1200);
    expect(result).toEqual({ groupId: 'user-1', type: 'user' });
  });

  it('finds closest system item', () => {
    const items: ChatItem[] = [makeSystemChatItem('sys-1', 3000)];
    const result = findChatItemByTimestamp(items, 3500);
    expect(result).toEqual({ groupId: 'sys-1', type: 'system' });
  });

  it('finds closest compact item', () => {
    const items: ChatItem[] = [makeCompactChatItem('compact-1', 4000)];
    const result = findChatItemByTimestamp(items, 3900);
    expect(result).toEqual({ groupId: 'compact-1', type: 'compact' });
  });

  it('prefers AI group when timestamp falls within range', () => {
    const items: ChatItem[] = [
      makeUserChatItem('user-1', 1500),
      makeAIChatItem('ai-1', 1000, 3000),
    ];
    // 1500 is within ai-1's range AND matches user-1 exactly — AI should win (exact range match)
    const result = findChatItemByTimestamp(items, 1500);
    expect(result).toEqual({ groupId: 'ai-1', type: 'ai' });
  });

  it('handles mixed item types', () => {
    const items: ChatItem[] = [
      makeUserChatItem('user-1', 0),
      makeAIChatItem('ai-1', 1000, 2000),
      makeSystemChatItem('sys-1', 3000),
      makeCompactChatItem('compact-1', 4000),
      makeUserChatItem('user-2', 5000),
    ];
    // 3500 is closest to sys-1 (3000, diff=500) vs compact-1 (4000, diff=500) — first wins
    const result = findChatItemByTimestamp(items, 3500);
    expect(result?.groupId).toBe('sys-1');
  });
});
