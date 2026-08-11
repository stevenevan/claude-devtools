import { beforeEach, expect, mock, test } from 'bun:test';

import type { SimpleCleanupPreview } from '@shared/types';

const previewSimpleCleanup = mock(async (): Promise<SimpleCleanupPreview> => ({
  token: 'fresh-token',
  totalCandidates: 2,
  totalBytes: 12,
  categories: [],
}));
const runSimpleCleanup = mock(async () => ({
  movedCandidates: 2,
  movedBytes: 12,
  storage: { totalBytes: 0, totalFiles: 0, buckets: [] },
}));
const scanClaudeDir = mock(async () => []);

mock.module('@shared/utils/logger', () => ({
  createLogger: () => ({ error: () => {} }),
}));
mock.module('@renderer/api', () => ({
  api: {
    maintenance: { previewSimpleCleanup, runSimpleCleanup, scanClaudeDir },
  },
}));

const { createMaintenanceSlice } = await import('./maintenanceSlice');

let state: Record<string, unknown>;

beforeEach(() => {
  previewSimpleCleanup.mockReset();
  previewSimpleCleanup.mockResolvedValue({
    token: 'fresh-token',
    totalCandidates: 2,
    totalBytes: 12,
    categories: [],
  });
  runSimpleCleanup.mockReset();
  runSimpleCleanup.mockResolvedValue({
    movedCandidates: 2,
    movedBytes: 12,
    storage: { totalBytes: 0, totalFiles: 0, buckets: [] },
  });
  scanClaudeDir.mockReset();
  scanClaudeDir.mockResolvedValue([]);

  const set = (update: unknown): void => {
    const next = typeof update === 'function' ? (update as (value: unknown) => unknown)(state) : update;
    Object.assign(state, next);
  };
  const get = (): unknown => state;
  const slice = createMaintenanceSlice(set as never, get as never, undefined as never);
  state = { ...slice, connectionMode: 'local' };
});

test('clears an old preview before a fresh preview starts', async () => {
  state.simpleCleanupPreview = {
    token: 'old-token',
    totalCandidates: 1,
    totalBytes: 4,
    categories: [],
  };

  const pending = (state.previewSimpleCleanup as () => Promise<void>)();
  expect(state.simpleCleanupPreview).toBeNull();
  expect(state.simpleCleanupScanning).toBe(true);
  await pending;
  expect((state.simpleCleanupPreview as SimpleCleanupPreview).token).toBe('fresh-token');
  expect(state.simpleCleanupScanning).toBe(false);
});

test('fails closed when the preview scan fails', async () => {
  previewSimpleCleanup.mockRejectedValueOnce(new Error('scan failed'));
  state.simpleCleanupPreview = {
    token: 'old-token',
    totalCandidates: 1,
    totalBytes: 4,
    categories: [],
  };

  await (state.previewSimpleCleanup as () => Promise<void>)();
  expect(state.simpleCleanupPreview).toBeNull();
  expect(state.simpleCleanupScanning).toBe(false);
  expect(state.simpleCleanupError).toBe('scan failed');
});
