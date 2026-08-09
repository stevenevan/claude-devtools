import { describe, expect, test } from 'bun:test';

import {
  cacheConfirmedUIMode,
  readCachedUIMode,
  UI_MODE_CACHE_KEY,
} from './uiModeBootstrap';

import type { UIMode } from '@shared/types';

function createStorage(initialMode?: string): {
  storage: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void };
  readMode: () => string | null;
} {
  const values = new Map<string, string>();
  if (initialMode) values.set(UI_MODE_CACHE_KEY, initialMode);
  return {
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
    readMode: () => values.get(UI_MODE_CACHE_KEY) ?? null,
  };
}

function configWithMode(uiMode: UIMode): { general: { uiMode: UIMode } } {
  return { general: { uiMode } };
}

describe('UI mode bootstrap cache', () => {
  test('uses nerd when cache is empty or invalid', () => {
    expect(readCachedUIMode(createStorage().storage)).toBe('nerd');
    expect(readCachedUIMode(createStorage('expert').storage)).toBe('nerd');
  });

  test('uses a valid cached mode before config loads', () => {
    expect(readCachedUIMode(createStorage('simple').storage)).toBe('simple');
  });

  test('reconciles stale cache with Rust-confirmed config', () => {
    const { storage, readMode } = createStorage('simple');
    const config = configWithMode('nerd');

    expect(cacheConfirmedUIMode(config, storage)).toBe(config);
    expect(readMode()).toBe('nerd');
  });
});
