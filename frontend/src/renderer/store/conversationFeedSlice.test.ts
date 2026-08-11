import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';

import { createTauriClient } from '@renderer/api/tauriClient';

import type { PaginatedGlobalSessionsResult } from '@shared/types';

const firstPage: PaginatedGlobalSessionsResult = {
  sessions: [
    {
      id: 'session-a',
      projectId: 'project-a',
      projectPath: '/projects/alpha',
      projectName: 'alpha',
      createdAt: 100,
      messageCount: 4,
      customTitle: 'Fix login',
      costUsd: 0.12,
    },
  ],
  nextCursor: 'cursor-a',
  hasMore: true,
};

type PendingResponse = PaginatedGlobalSessionsResult | Promise<PaginatedGlobalSessionsResult>;

function deferredResponse(): {
  promise: Promise<PaginatedGlobalSessionsResult>;
  resolve: (value: PaginatedGlobalSessionsResult) => void;
} {
  let resolve = (_value: PaginatedGlobalSessionsResult): void => {};
  const promise = new Promise<PaginatedGlobalSessionsResult>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

let responses: PendingResponse[] = [firstPage];
let failure: Error | null = null;
const cursors: Array<string | null> = [];

const actualApi = createTauriClient();
const testApi = {
  ...actualApi,
  getGlobalSessionsPaginated: async (cursor: string | null) => {
    cursors.push(cursor);
    if (failure) throw failure;
    const response = responses.shift();
    if (!response) throw new Error('missing test response');
    return await response;
  },
};

mock.module('@shared/utils/logger', () => ({
  createLogger: () => ({ error: () => {} }),
}));

mock.module('@renderer/api', () => ({
  api: testApi,
}));

let useStore: typeof import('./useStore').useStore;

beforeAll(async () => {
  const values = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
  ({ useStore } = await import('./useStore'));
});

beforeEach(() => {
  responses = [firstPage];
  failure = null;
  cursors.length = 0;
  useStore.setState({
    conversationFeedRows: [],
    conversationFeedCursor: null,
    conversationFeedHasMore: false,
    conversationFeedLoading: false,
    conversationFeedLoadingMore: false,
    conversationFeedLoaded: false,
    conversationFeedError: null,
    selectedProjectId: null,
  });
});

afterAll(() => {
  mock.module('@renderer/api', () => ({ api: actualApi }));
});

test('loads and caches feed independently of selected project', async () => {
  useStore.setState({ selectedProjectId: 'unrelated-project' });
  await useStore.getState().fetchConversationFeed();
  useStore.setState({ selectedProjectId: 'another-project' });
  await useStore.getState().fetchConversationFeed();

  expect(cursors).toEqual([null]);
  expect(useStore.getState().conversationFeedRows).toEqual(firstPage.sessions);
  expect(useStore.getState().conversationFeedCursor).toBe('cursor-a');
  expect(useStore.getState().conversationFeedLoaded).toBe(true);
});

test('appends later pages using global cursor', async () => {
  const secondPage: PaginatedGlobalSessionsResult = {
    sessions: [
      firstPage.sessions[0],
      {
        id: 'session-b',
        projectId: 'project-b',
        projectPath: '/projects/beta',
        projectName: 'beta',
        createdAt: 90,
        messageCount: 2,
      },
    ],
    nextCursor: null,
    hasMore: false,
  };
  responses.push(secondPage);

  await useStore.getState().fetchConversationFeed();
  await useStore.getState().fetchMoreConversationFeed();

  expect(cursors).toEqual([null, 'cursor-a']);
  expect(useStore.getState().conversationFeedRows).toEqual([
    firstPage.sessions[0],
    secondPage.sessions[1],
  ]);
  expect(useStore.getState().conversationFeedHasMore).toBe(false);
});

test('coalesces duplicate initial and append requests', async () => {
  const initial = deferredResponse();
  const append = deferredResponse();
  responses = [initial.promise, append.promise];

  const firstInitial = useStore.getState().fetchConversationFeed();
  const secondInitial = useStore.getState().fetchConversationFeed();
  expect(cursors).toEqual([null]);
  initial.resolve(firstPage);
  await Promise.all([firstInitial, secondInitial]);

  const firstAppend = useStore.getState().fetchMoreConversationFeed();
  const secondAppend = useStore.getState().fetchMoreConversationFeed();
  expect(cursors).toEqual([null, 'cursor-a']);
  append.resolve({ sessions: [], nextCursor: null, hasMore: false });
  await Promise.all([firstAppend, secondAppend]);

  expect(useStore.getState().conversationFeedLoading).toBe(false);
  expect(useStore.getState().conversationFeedLoadingMore).toBe(false);
});

test('ignores stale refresh responses', async () => {
  const stale = deferredResponse();
  const fresh = deferredResponse();
  responses = [stale.promise, fresh.promise];

  const staleRequest = useStore.getState().fetchConversationFeed();
  const freshRequest = useStore.getState().fetchConversationFeed(true);
  fresh.resolve({ sessions: [], nextCursor: null, hasMore: false });
  await freshRequest;
  stale.resolve(firstPage);
  await staleRequest;

  expect(useStore.getState().conversationFeedRows).toEqual([]);
  expect(useStore.getState().conversationFeedError).toBeNull();
  expect(useStore.getState().conversationFeedLoading).toBe(false);
});

test('ignores append response superseded by refresh', async () => {
  const append = deferredResponse();
  const refresh = deferredResponse();
  responses = [firstPage, append.promise, refresh.promise];
  await useStore.getState().fetchConversationFeed();

  const appendRequest = useStore.getState().fetchMoreConversationFeed();
  const refreshRequest = useStore.getState().fetchConversationFeed(true);
  refresh.resolve({ sessions: [], nextCursor: null, hasMore: false });
  await refreshRequest;
  append.resolve(firstPage);
  await appendRequest;

  expect(useStore.getState().conversationFeedRows).toEqual([]);
  expect(useStore.getState().conversationFeedError).toBeNull();
  expect(useStore.getState().conversationFeedLoading).toBe(false);
  expect(useStore.getState().conversationFeedLoadingMore).toBe(false);
});

test('force refresh replaces cached rows', async () => {
  responses.push({ sessions: [], nextCursor: null, hasMore: false });
  await useStore.getState().fetchConversationFeed();
  await useStore.getState().fetchConversationFeed(true);

  expect(cursors).toEqual([null, null]);
  expect(useStore.getState().conversationFeedRows).toEqual([]);
});

test('records refresh errors without discarding cached rows', async () => {
  await useStore.getState().fetchConversationFeed();
  failure = new Error('feed unavailable');
  await useStore.getState().fetchConversationFeed(true);

  expect(useStore.getState().conversationFeedRows).toEqual(firstPage.sessions);
  expect(useStore.getState().conversationFeedError).toBe('feed unavailable');
  expect(useStore.getState().conversationFeedLoading).toBe(false);
});
