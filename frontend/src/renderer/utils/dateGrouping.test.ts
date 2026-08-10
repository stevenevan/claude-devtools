import { expect, test } from 'bun:test';

import { getDateGroupLabel, groupSessionsByDate } from './dateGrouping';

import type { Session } from '../types/data';

const NOW = new Date(2026, 7, 10, 12, 0, 0);

function session(createdAt: number): Session {
  return { createdAt } as Session;
}

test('labels calendar days relative to the supplied current date', () => {
  expect(getDateGroupLabel(new Date(2026, 7, 10, 9).getTime(), NOW)).toBe('Today');
  expect(getDateGroupLabel(new Date(2026, 7, 9, 23).getTime(), NOW)).toBe('Yesterday');
  expect(getDateGroupLabel(new Date(2026, 2, 12, 9).getTime(), NOW)).toBe('12 March');
});

test('keeps existing session date categories intact', () => {
  const now = new Date();
  const grouped = groupSessionsByDate([
    session(now.getTime()),
    session(now.getTime() - 24 * 60 * 60 * 1000),
    session(now.getTime() - 8 * 24 * 60 * 60 * 1000),
  ]);

  expect(grouped.Today).toHaveLength(1);
  expect(grouped.Yesterday).toHaveLength(1);
  expect(grouped.Older).toHaveLength(1);
});
