import { describe, expect, it } from 'vitest';

import {
  buildSubagentTree,
  maxDepth,
  totalNodes,
} from '../../../src/renderer/utils/subagentTreeLayout';

import type {
  Process,
  SessionMetrics,
} from '../../../src/shared/types/chunks';
import type { ContentBlock } from '../../../src/shared/types/jsonl';

function emptyMetrics(): SessionMetrics {
  return {
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    durationMs: 0,
    costUsd: 0,
    toolCallCount: 0,
    assistantMessageCount: 0,
    userMessageCount: 0,
    errorCount: 0,
  };
}

function makeProcess(id: string, parentTaskId: string | undefined, toolUseIds: string[]): Process {
  const content: ContentBlock[] = toolUseIds.map((tid) => ({
    type: 'tool_use',
    id: tid,
    name: 'Task',
    input: {},
  }));
  return {
    id,
    filePath: `/tmp/${id}.jsonl`,
    messages:
      toolUseIds.length > 0
        ? [
            {
              uuid: `u-${id}`,
              parentUuid: null,
              type: 'assistant',
              timestamp: new Date(0),
              content,
            },
          ]
        : [],
    startTime: new Date(0),
    endTime: new Date(1),
    durationMs: 1,
    metrics: emptyMetrics(),
    isParallel: false,
    isOngoing: false,
    parentTaskId,
  };
}

describe('buildSubagentTree', () => {
  it('returns empty tree for no processes', () => {
    expect(buildSubagentTree([])).toEqual([]);
    expect(maxDepth([])).toBe(0);
  });

  it('nests processes via parentTaskId → tool_use owner', () => {
    const a = makeProcess('A', undefined, ['task-1']);
    const b = makeProcess('B', 'task-1', ['task-2']);
    const c = makeProcess('C', 'task-2', []);
    const tree = buildSubagentTree([a, b, c]);
    expect(tree).toHaveLength(1);
    expect(tree[0].process.id).toBe('A');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].process.id).toBe('B');
    expect(tree[0].children[0].children[0].process.id).toBe('C');
    expect(maxDepth(tree)).toBe(3);
  });

  it('handles 5-level depth without overflow', () => {
    const processes: Process[] = [];
    for (let i = 0; i < 5; i++) {
      const parentId = i === 0 ? undefined : `t-${i - 1}`;
      processes.push(makeProcess(`P${i}`, parentId, [`t-${i}`]));
    }
    const tree = buildSubagentTree(processes);
    expect(totalNodes(tree)).toBe(5);
    expect(maxDepth(tree)).toBe(5);
  });

  it('filters subagents with 0 tool calls when hideEmpty', () => {
    const a = makeProcess('A', undefined, ['t1']);
    const b = makeProcess('B', 't1', []); // empty
    const c = makeProcess('C', undefined, []); // empty, root
    const tree = buildSubagentTree([a, b, c], { hideEmpty: true });
    // A survives (has tool_use), B dropped (empty child with no descendants), C dropped.
    expect(tree).toHaveLength(1);
    expect(tree[0].process.id).toBe('A');
    expect(tree[0].children).toHaveLength(0);
  });

  it('keeps empty parents when they have surviving descendants', () => {
    const a = makeProcess('A', undefined, []); // empty root
    const b = makeProcess('B', undefined, ['t1']); // lifts itself
    const c = makeProcess('C', 't1', ['t2']); // child under B
    const tree = buildSubagentTree([a, b, c], { hideEmpty: true });
    // A is dropped; B survives with C as a child.
    const ids = tree.map((n) => n.process.id);
    expect(ids).toContain('B');
    expect(ids).not.toContain('A');
  });
});
