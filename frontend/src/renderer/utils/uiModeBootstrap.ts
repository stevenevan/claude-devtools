import type { UIMode } from '@shared/types';

export const UI_MODE_CACHE_KEY = 'claude-devtools-ui-mode';

interface UIModeStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

function getBrowserStorage(): UIModeStorage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function readCachedUIMode(storage = getBrowserStorage()): UIMode {
  try {
    return storage?.getItem(UI_MODE_CACHE_KEY) === 'simple' ? 'simple' : 'nerd';
  } catch {
    return 'nerd';
  }
}

export function cacheConfirmedUIMode<T extends { general: { uiMode: UIMode } }>(
  config: T,
  storage = getBrowserStorage()
): T {
  try {
    storage?.setItem(UI_MODE_CACHE_KEY, config.general.uiMode);
  } catch {
    return config;
  }
  return config;
}
