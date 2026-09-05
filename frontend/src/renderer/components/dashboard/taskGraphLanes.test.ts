import { describe, expect, test } from 'bun:test';

import { groupNodesByLane, laneForStatus, TASK_LANES } from './taskGraphLanes';

function node(id: string, status: string): { id: string; status: string } {
  return { id, status };
}

describe('task graph lane derivation', () => {
  test('maps explicit lifecycle statuses to done, now, and next', () => {
    expect(laneForStatus('completed')).toBe('done');
    expect(laneForStatus('in_progress')).toBe('now');
    expect(laneForStatus('pending')).toBe('next');
  });

  test('parks unknown statuses in next without inferring from text', () => {
    expect(laneForStatus('')).toBe('next');
    expect(laneForStatus('cancelled')).toBe('next');
    expect(laneForStatus('COMPLETED')).toBe('next');
  });

  test('groups a lifecycle event sequence while preserving order', () => {
    const groups = groupNodesByLane([
      node('setup', 'completed'),
      node('migrate', 'in_progress'),
      node('verify', 'pending'),
      node('cleanup', 'completed'),
      node('report', 'mystery-status'),
    ]);

    expect(groups.done.map((entry) => entry.id)).toEqual(['setup', 'cleanup']);
    expect(groups.now.map((entry) => entry.id)).toEqual(['migrate']);
    expect(groups.next.map((entry) => entry.id)).toEqual(['verify', 'report']);
  });

  test('tracks a node moving through the lifecycle across reads', () => {
    const first = groupNodesByLane([node('work', 'pending')]);
    expect(first.next.map((entry) => entry.id)).toEqual(['work']);

    const second = groupNodesByLane([node('work', 'in_progress')]);
    expect(second.now.map((entry) => entry.id)).toEqual(['work']);

    const third = groupNodesByLane([node('work', 'completed')]);
    expect(third.done.map((entry) => entry.id)).toEqual(['work']);
  });

  test('labels every lane in text so color is never the sole carrier', () => {
    expect(TASK_LANES.map((lane) => lane.id)).toEqual(['done', 'now', 'next']);
    for (const lane of TASK_LANES) {
      expect(lane.label.trim().length).toBeGreaterThan(0);
      expect(lane.hint.trim().length).toBeGreaterThan(0);
    }
  });
});
