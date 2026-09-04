import { beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';

import {
  api as actualApi,
  initializeApi as actualInitializeApi,
  isDesktopMode as actualIsDesktopMode,
} from '@renderer/api';
import { createTauriClient } from '@renderer/api/tauriClient';

import type { AppConfig, UIMode } from '@shared/types';

function configWithMode(uiMode: UIMode): AppConfig {
  return {
    notifications: {
      enabled: true,
      soundEnabled: true,
      ignoredRegex: [],
      ignoredRepositories: [],
      snoozedUntil: null,
      snoozeMinutes: 30,
      includeSubagentErrors: true,
      triggers: [],
      retentionDays: 30,
      maxCount: 500,
    },
    general: {
      launchAtLogin: false,
      theme: 'system',
      defaultTab: 'dashboard',
      claudeRootPath: null,
      autoExpandAIGroups: false,
      useNativeTitleBar: false,
      uiMode,
    },
    display: {
      codeBlockTheme: 'default',
      showLineNumbers: true,
      wordWrap: true,
    },
    sessions: {
      pinnedSessions: {},
      hiddenSessions: {},
    },
  };
}

function deferredConfig(): {
  promise: Promise<AppConfig>;
  resolve: (value: AppConfig) => void;
  reject: (reason: Error) => void;
} {
  let resolve = (_value: AppConfig): void => {};
  let reject = (_reason: Error): void => {};
  const promise = new Promise<AppConfig>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

let pending = deferredConfig();
let getCallCount = 0;

const client = createTauriClient();
const testApi = {
  ...client,
  config: {
    ...client.config,
    get: async () => {
      getCallCount += 1;
      return await pending.promise;
    },
  },
};

mock.module('@shared/utils/logger', () => ({
  createLogger: () => ({ error: () => {} }),
}));

mock.module('@renderer/api', () => ({
  api: testApi,
  initializeApi: actualInitializeApi,
  isDesktopMode: actualIsDesktopMode,
}));

let useStore: typeof import('./index').useStore;

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
  ({ useStore } = await import('./index'));
});

beforeEach(() => {
  pending = deferredConfig();
  getCallCount = 0;
  useStore.setState(useStore.getInitialState(), true);
});

describe('config preload sequencing', () => {
  test('starts idle with a null config so the shell renders its skeleton', () => {
    expect(useStore.getState().configStatus).toBe('idle');
    expect(useStore.getState().appConfig).toBeNull();
  });

  test('moves loading to ready and shares one fetch across concurrent preloads', async () => {
    const first = useStore.getState().preloadConfig();
    const second = useStore.getState().preloadConfig();
    expect(useStore.getState().configStatus).toBe('loading');

    pending.resolve(configWithMode('nerd'));
    await first;
    await second;

    expect(getCallCount).toBe(1);
    expect(useStore.getState().configStatus).toBe('ready');
    expect(useStore.getState().appConfig?.general.uiMode).toBe('nerd');
  });

  test('moves to error when the fetch fails and recovers on retry', async () => {
    const attempt = useStore.getState().preloadConfig();
    pending.reject(new Error('disk unavailable'));
    await attempt;

    expect(useStore.getState().configStatus).toBe('error');
    expect(useStore.getState().configError).toBe('disk unavailable');
    expect(useStore.getState().appConfig).toBeNull();

    pending = deferredConfig();
    const retry = useStore.getState().preloadConfig();
    expect(useStore.getState().configStatus).toBe('loading');
    pending.resolve(configWithMode('simple'));
    await retry;

    expect(useStore.getState().configStatus).toBe('ready');
    expect(useStore.getState().appConfig?.general.uiMode).toBe('simple');
  });
});
