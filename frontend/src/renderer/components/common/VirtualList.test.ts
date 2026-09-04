import { beforeEach, describe, expect, test } from 'bun:test';

import {
  VIRTUAL_LIST_OVERSCAN,
  VIRTUAL_LIST_THRESHOLD,
  clearVirtualListScroll,
  readVirtualListScroll,
  resolveVirtualListPlan,
  saveVirtualListScroll,
} from './VirtualList';

beforeEach(() => {
  clearVirtualListScroll();
});

describe('virtual list windowing plan', () => {
  test('windows 10k rows to the visible range plus overscan instead of mounting them all', () => {
    const plan = resolveVirtualListPlan(10_000);
    expect(plan.mode).toBe('windowed');
    expect(plan.overscan).toBe(VIRTUAL_LIST_OVERSCAN);

    const viewportRows = Math.ceil(600 / 64);
    const mounted = viewportRows + plan.overscan * 2;
    expect(mounted).toBeLessThan(10_000);
    expect(mounted).toBeLessThanOrEqual(viewportRows + VIRTUAL_LIST_OVERSCAN * 2);
  });

  test('renders small lists plainly with no behavior change', () => {
    expect(resolveVirtualListPlan(0).mode).toBe('plain');
    expect(resolveVirtualListPlan(VIRTUAL_LIST_THRESHOLD).mode).toBe('plain');
    expect(resolveVirtualListPlan(VIRTUAL_LIST_THRESHOLD + 1).mode).toBe('windowed');
  });

  test('clamps invalid overscan values', () => {
    expect(resolveVirtualListPlan(10_000, VIRTUAL_LIST_THRESHOLD, -3).overscan).toBe(0);
  });
});

describe('virtual list scroll restoration', () => {
  test('round-trips a saved offset per scroll key', () => {
    saveVirtualListScroll('history', 420);
    expect(readVirtualListScroll('history')).toBe(420);
    expect(readVirtualListScroll('tasks')).toBeUndefined();
  });

  test('ignores non-finite offsets so refetch never jumps', () => {
    saveVirtualListScroll('history', Number.NaN);
    expect(readVirtualListScroll('history')).toBeUndefined();
  });

  test('clears a single key or the whole store', () => {
    saveVirtualListScroll('history', 10);
    saveVirtualListScroll('tasks', 20);
    clearVirtualListScroll('history');
    expect(readVirtualListScroll('history')).toBeUndefined();
    expect(readVirtualListScroll('tasks')).toBe(20);
    clearVirtualListScroll();
    expect(readVirtualListScroll('tasks')).toBeUndefined();
  });
});
