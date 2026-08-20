import { beforeAll, beforeEach, expect, mock, test } from 'bun:test';

import {
  api as actualApi,
  initializeApi as actualInitializeApi,
  isDesktopMode as actualIsDesktopMode,
} from '@renderer/api';

import type { DesktopAPI, InspectorEvent, InspectorPage, InspectorSourceStatus } from '@shared/types/api';

let readSourceSession: DesktopAPI['readSourceSession'];
const testApi = new Proxy(actualApi, {
  get(target, property, receiver) {
    if (property === 'readSourceSession') return readSourceSession;
    return Reflect.get(target, property, receiver);
  },
});

mock.module('@renderer/api', () => ({
  api: testApi,
  initializeApi: actualInitializeApi,
  isDesktopMode: actualIsDesktopMode,
}));

let useStore: typeof import('@renderer/store').useStore;

const status: InspectorSourceStatus = {
  sourceKind: 'codex',
  state: 'available',
  label: 'CODEX_HOME',
  revision: 'revision-1',
  capabilities: {
    sessions: true,
    transcripts: true,
    taskGraph: { state: 'available', reason: 'available', diagnostics: [] },
    maintenance: {
      usage: { state: 'available', reason: 'available', diagnostics: [] },
      telemetry: { state: 'available', reason: 'available', diagnostics: [] },
      fileHistory: { state: 'available', reason: 'available', diagnostics: [] },
      shellSnapshots: { state: 'available', reason: 'available', diagnostics: [] },
    },
  },
};

function event(line: number, kind: string): InspectorEvent {
  return {
    kind,
    timestamp: null,
    role: null,
    content: null,
    toolName: null,
    toolId: null,
    toolInputShape: null,
    toolOutputSize: null,
    toolStatus: null,
    truncated: false,
    provenance: { sourceFile: 'sessions/rollout-s1.jsonl', line, archived: false },
  };
}

function page(
  items: InspectorEvent[],
  nextCursor: string | null,
  hasMore: boolean
): InspectorPage<InspectorEvent> {
  return {
    items,
    nextCursor,
    hasMore,
    totalMatched: 3,
    scanLimited: false,
    diagnostics: [],
    revision: 'rollout-revision-1',
    session: {
      sessionId: 's1',
      project: 'project',
      transcriptId: 'sessions/rollout-s1.jsonl',
      turnCount: 1,
      eventCount: 3,
      countsComplete: true,
      source: 'codex',
      provenance: { sourceFile: 'sessions/rollout-s1.jsonl', line: 1, archived: false },
    },
  };
}

beforeAll(async () => {
  ({ useStore } = await import('@renderer/store'));
});

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  useStore.setState({ inspectorSource: 'codex', inspectorSources: [status], inspectorSourceGeneration: 1 });
});

test('refreshes the first session page and appends later pages without duplicates', async () => {
  const calls: Array<string | null> = [];
  readSourceSession = async (_source, _id, cursor) => {
    calls.push(cursor);
    return cursor === null
      ? page([event(1, 'message'), event(2, 'message')], 'cursor-1', true)
      : page([event(2, 'message'), event(3, 'unknown')], null, false);
  };

  await useStore.getState().loadInspectorSession('s1');
  expect(useStore.getState().inspectorSessionEvents).toHaveLength(2);
  expect(useStore.getState().inspectorSessionSummary?.project).toBe('project');
  expect(useStore.getState().inspectorSessionHasMore).toBe(true);

  await useStore.getState().loadMoreInspectorSession();
  expect(useStore.getState().inspectorSessionEvents.map((item) => item.kind)).toEqual([
    'message',
    'message',
    'unknown',
  ]);
  expect(useStore.getState().inspectorSessionHasMore).toBe(false);

  await useStore.getState().loadInspectorSession('s1');
  expect(calls).toEqual([null, 'cursor-1', null]);
});

test('switching source clears selections and cached source data', () => {
  useStore.setState({
    inspectorSelectedSessionId: 's1',
    inspectorSelectedTaskGraphId: 'task-1',
    inspectorSessionEvents: [event(1, 'message')],
    inspectorCache: { claude: { items: ['wrong source'] } },
  });

  useStore.getState().setInspectorSource('claude');

  const state = useStore.getState();
  expect(state.inspectorSource).toBe('claude');
  expect(state.inspectorSourceGeneration).toBe(2);
  expect(state.inspectorCache).toEqual({});
  expect(state.inspectorSelectedSessionId).toBeNull();
  expect(state.inspectorSelectedTaskGraphId).toBeNull();
  expect(state.inspectorSessionEvents).toEqual([]);
});

test('keeps inventory source independent from dual-source inspector source', () => {
  useStore.getState().setInspectorSource('claude');
  useStore.getState().setInventorySource('codex');

  expect(useStore.getState().inspectorSource).toBe('claude');
  expect(useStore.getState().inventorySource).toBe('codex');

  useStore.getState().setInventorySource('claude');
  expect(useStore.getState().inspectorSource).toBe('claude');
  expect(useStore.getState().inventorySource).toBe('claude');
});
