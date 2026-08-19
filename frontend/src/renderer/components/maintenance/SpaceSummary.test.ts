import { expect, test } from 'bun:test';

import type { DirUsage } from '@shared/types';

import {
  SIMPLE_CLEANUP_ALLOWLIST,
  shouldRunSimpleCleanup,
  summarizeSpace,
} from './SpaceSummary';

function dir(path: string, bytes: number, files: number): DirUsage {
  return {
    path,
    bytes,
    files,
    modTime: new Date(0),
    isSymlink: false,
  };
}

test('groups storage into three redacted display buckets and preserves totals', () => {
  const result = summarizeSpace([
    dir('/home/user/.claude/file-history', 100, 4),
    dir('/home/user/.claude/logs', 200, 3),
    dir('/home/user/.claude/caches', 300, 2),
    dir('/home/user/.claude/projects', 400, 1),
  ]);

  expect(result.totalBytes).toBe(1000);
  expect(result.totalFiles).toBe(10);
  expect(result.buckets).toEqual([
    { id: 'old-file-versions', label: 'Old file versions', bytes: 100, files: 4 },
    { id: 'logs-and-caches', label: 'Logs and caches', bytes: 500, files: 5 },
    { id: 'everything-else', label: 'Everything else', bytes: 400, files: 1 },
  ]);
  expect(JSON.stringify(result)).not.toContain('/home/user');
});

test('keeps the Simple action allowlist explicit and excludes broad categories', () => {
  expect([...SIMPLE_CLEANUP_ALLOWLIST]).toEqual([
    'file-history',
    'junk-dsstore',
    'junk-tmp',
    'junk-emptydirs',
    'runtime-tasks-empty',
    'runtime-jobs',
  ]);
  expect(SIMPLE_CLEANUP_ALLOWLIST).not.toContain('projects');
  expect(SIMPLE_CLEANUP_ALLOWLIST).not.toContain('logs');
  expect(SIMPLE_CLEANUP_ALLOWLIST).not.toContain('caches');
});

test('does not run Claude storage cleanup for Codex or remote sources', () => {
  expect(shouldRunSimpleCleanup(true, 'claude')).toBe(true);
  expect(shouldRunSimpleCleanup(true, 'codex')).toBe(false);
  expect(shouldRunSimpleCleanup(false, 'claude')).toBe(false);
});
