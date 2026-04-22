import { describe, it, expect } from 'vitest';

import { buildTurnBreakdown } from '../../../src/renderer/utils/contextTracker';

import type { TokensByCategory } from '../../../src/renderer/types/contextInjection';

function make(partial: Partial<TokensByCategory>): TokensByCategory {
  return {
    claudeMd: 0,
    mentionedFiles: 0,
    toolOutputs: 0,
    thinkingText: 0,
    taskCoordination: 0,
    userMessages: 0,
    ...partial,
  };
}

describe('buildTurnBreakdown', () => {
  it('returns empty breakdown when no tokens', () => {
    const b = buildTurnBreakdown('ai-0', 0, make({}));
    expect(b.totalTokens).toBe(0);
    expect(b.dominantCategory).toBeNull();
    expect(b.entries).toEqual([]);
  });

  it('sorts entries descending and picks dominant category', () => {
    const b = buildTurnBreakdown(
      'ai-1',
      1,
      make({ claudeMd: 200, toolOutputs: 800, thinkingText: 100 })
    );
    expect(b.totalTokens).toBe(1100);
    expect(b.dominantCategory).toBe('toolOutputs');
    expect(b.entries.map((e) => e.category)).toEqual([
      'toolOutputs',
      'claudeMd',
      'thinkingText',
    ]);
  });

  it('excludes zero-token categories and computes sharePct', () => {
    const b = buildTurnBreakdown('ai-2', 2, make({ userMessages: 50, toolOutputs: 150 }));
    expect(b.entries).toHaveLength(2);
    expect(b.entries[0].category).toBe('toolOutputs');
    expect(b.entries[0].sharePct).toBe(75);
    expect(b.entries[1].sharePct).toBe(25);
  });

  it('carries through the provided ids', () => {
    const b = buildTurnBreakdown('ai-42', 41, make({ claudeMd: 1 }));
    expect(b.aiGroupId).toBe('ai-42');
    expect(b.turnIndex).toBe(41);
  });
});
