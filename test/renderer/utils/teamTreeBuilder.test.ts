import { describe, expect, it } from 'vitest';

import { buildTeamTree } from '../../../src/renderer/utils/teamTreeBuilder';

import type { Process, SessionMetrics } from '../../../src/shared/types/chunks';

function metrics(): SessionMetrics {
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

function makeProcess(
  overrides: Partial<Process> & { id: string }
): Process {
  return {
    id: overrides.id,
    filePath: `/tmp/${overrides.id}.jsonl`,
    messages: [],
    startTime: new Date(0),
    endTime: new Date(1),
    durationMs: 1,
    metrics: metrics(),
    isParallel: false,
    isOngoing: false,
    ...overrides,
  };
}

describe('buildTeamTree', () => {
  it('groups members under their team', () => {
    const processes: Process[] = [
      makeProcess({
        id: 'p1',
        team: { teamName: 'Alpha', memberName: 'Explorer', memberColor: '#abc' },
      }),
      makeProcess({
        id: 'p2',
        team: { teamName: 'Alpha', memberName: 'Planner', memberColor: '#def' },
      }),
    ];
    const tree = buildTeamTree(processes);
    expect(tree).toHaveLength(1);
    expect(tree[0].kind).toBe('team');
    expect(tree[0].label).toBe('Alpha');
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children.map((c) => c.label)).toEqual(['Explorer', 'Planner']);
  });

  it('nests spawned subagents under the spawning member', () => {
    const parentProcess: Process = makeProcess({
      id: 'parent',
      team: { teamName: 'Alpha', memberName: 'Lead', memberColor: '#abc' },
      messages: [
        {
          uuid: 'u1',
          parentUuid: null,
          type: 'assistant',
          timestamp: new Date(0),
          content: [
            { type: 'tool_use', id: 'task-abc', name: 'Task', input: {} },
          ],
        },
      ],
    });
    const childProcess: Process = makeProcess({
      id: 'child',
      parentTaskId: 'task-abc',
      team: { teamName: 'Alpha', memberName: 'Helper', memberColor: '#999' },
    });
    const tree = buildTeamTree([parentProcess, childProcess]);
    expect(tree[0].children).toHaveLength(2);
    const lead = tree[0].children.find((c) => c.label === 'Lead');
    expect(lead?.children).toHaveLength(1);
    expect(lead?.children[0].label).toBe('Helper');
  });

  it('emits orphan solo processes as top-level solo nodes', () => {
    const lone = makeProcess({ id: 'lone', subagentType: 'Explore' });
    const tree = buildTeamTree([lone]);
    expect(tree).toHaveLength(1);
    expect(tree[0].kind).toBe('solo');
    expect(tree[0].label).toBe('Explore');
  });

  it('sums tool counts for team totals', () => {
    const p: Process = makeProcess({
      id: 'p1',
      team: { teamName: 'Beta', memberName: 'Alice', memberColor: '#fff' },
      messages: [
        {
          uuid: 'u1',
          parentUuid: null,
          type: 'assistant',
          timestamp: new Date(0),
          content: [
            { type: 'tool_use', id: 't1', name: 'Read', input: {} },
            { type: 'tool_use', id: 't2', name: 'Bash', input: {} },
          ],
        },
      ],
    });
    const tree = buildTeamTree([p]);
    expect(tree[0].toolCount).toBe(2);
    expect(tree[0].children[0].toolCount).toBe(2);
  });
});
