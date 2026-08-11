import { expect, test } from 'bun:test';

import type { TaskNode } from '@shared/types/api';

import { buildTaskOutline } from './TaskOutline';

function node(id: string, overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id,
    subject: `Step ${id}`,
    description: `Description ${id}`,
    activeForm: `Doing ${id}`,
    status: 'pending',
    blocks: [],
    blockedBy: [],
    ...overrides,
  };
}

test('canonicalizes reciprocal blocks and blockedBy entries', () => {
  const result = buildTaskOutline([
    node('a', { blocks: ['b'] }),
    node('b', { blockedBy: ['a'] }),
  ]);

  expect(result.anomalies).toEqual([]);
  expect(result.roots.map((item) => item.node.id)).toEqual(['a']);
  expect(result.roots[0]?.children.map((item) => item.node.id)).toEqual(['b']);
});

test('keeps a multiply-required node once at shallowest depth and records alternate parents', () => {
  const result = buildTaskOutline([
    node('root', { blocks: ['middle', 'leaf'] }),
    node('middle', { blockedBy: ['root'], blocks: ['leaf'] }),
    node('leaf', { blockedBy: ['root', 'middle'] }),
  ]);

  const root = result.roots[0];
  expect(root?.children.map((item) => item.node.id)).toEqual(['middle', 'leaf']);
  expect(root?.children[1]?.depth).toBe(1);
  expect(root?.children[1]?.alternateParents).toEqual(['middle']);
  expect(root?.children[0]?.children).toEqual([]);
});

test('terminates on cycles and puts isolated or cyclic nodes under Other steps', () => {
  const result = buildTaskOutline([
    node('cycle-a', { blocks: ['cycle-b'] }),
    node('cycle-b', { blockedBy: ['cycle-a'], blocks: ['cycle-a'] }),
    node('isolated'),
  ]);

  expect(result.anomalies.some((anomaly) => anomaly.type === 'cycle')).toBe(true);
  expect(result.roots).toEqual([]);
  expect(result.other.map((item) => item.node.id)).toEqual(['cycle-a', 'cycle-b', 'isolated']);
});

test('marks missing references without dropping the known node', () => {
  const result = buildTaskOutline([node('known', { blockedBy: ['missing'] })]);

  expect(result.anomalies.some((anomaly) => anomaly.type === 'missing-reference')).toBe(true);
  expect(result.other.map((item) => item.node.id)).toEqual(['known']);
});
