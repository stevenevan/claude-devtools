import { expect, test } from 'bun:test';

import {
  flattenHistoryEntries,
  getHistoryProjectLabel,
  getHistoryProjectOptions,
} from './historyBrowserHelpers';

import type { HistoryEntry } from '@shared/types/api';
import type { Project } from '@renderer/types/data';

const NOW = new Date(2026, 7, 10, 12, 0, 0);

function entry(timestamp: number, project: string, display: string): HistoryEntry {
  return { timestamp, project, display, pastedCount: 0 };
}

function project(overrides: Partial<Project>): Project {
  return {
    id: 'project-1',
    path: '/workspace/my-project',
    name: 'my-project',
    sessions: [],
    createdAt: 1,
    ...overrides,
  };
}

test('flattens entries into stable day headings and entry keys', () => {
  const entries = [
    entry(new Date(2026, 7, 10, 9).getTime(), '/workspace/my-project', 'Today prompt'),
    entry(new Date(2026, 7, 10, 8).getTime(), '/workspace/my-project', 'Second prompt'),
    entry(new Date(2026, 7, 9, 8).getTime(), '/workspace/my-project', 'Yesterday prompt'),
    entry(new Date(2026, 2, 12, 8).getTime(), '/workspace/other', 'Earlier prompt'),
  ];

  const first = flattenHistoryEntries(entries, NOW);
  const second = flattenHistoryEntries(entries, NOW);

  expect(first.map((item) => item.id)).toEqual(second.map((item) => item.id));
  expect(first.filter((item) => item.type === 'heading').map((item) => item.label)).toEqual([
    'Today',
    'Yesterday',
    '12 March',
  ]);
  expect(new Set(first.map((item) => item.id)).size).toBe(first.length);
});

test('uses folder names in Simple mode and preserves raw project values in Nerd mode', () => {
  const projects = [project({ id: 'encoded-project', path: '/workspace/my-project', name: 'my-project' })];

  expect(getHistoryProjectLabel('encoded-project', projects, 'simple')).toBe('my-project');
  expect(getHistoryProjectLabel('encoded-project', projects, 'nerd')).toBe('encoded-project');
  expect(getHistoryProjectLabel('-opaque-project-id', [], 'simple')).toBe('Unknown folder');
  expect(getHistoryProjectOptions([
    entry(1, 'encoded-project', 'one'),
    entry(2, '/workspace/other', 'two'),
  ], projects, 'simple')).toEqual([
    { value: 'encoded-project', label: 'my-project' },
    { value: '/workspace/other', label: 'other' },
  ]);
});
