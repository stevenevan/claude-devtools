import { createTauriClient } from './tauriClient';
import { createWailsClient } from './wailsClient';

import type { WailsAPI } from '@shared/types/api';

let client: WailsAPI | null = null;

// Dual-mode switch (invariant #4): the whole backend choice is this one flag.
// Defaults to Wails when VITE_BACKEND is unset. The flag dies at the W15 flip.
function createClient(): WailsAPI {
  return import.meta.env.VITE_BACKEND === 'tauri' ? createTauriClient() : createWailsClient();
}

export async function initializeApi(): Promise<void> {
  if (!client) {
    client = createClient();
  }
}

function getImpl(): WailsAPI {
  if (!client) {
    client = createClient();
  }
  return client;
}

export const isDesktopMode = (): boolean => true;

export const api: WailsAPI = new Proxy({} as WailsAPI, {
  get(_target, prop, receiver) {
    const impl = getImpl();
    const value = Reflect.get(impl, prop, receiver) as unknown;
    if (typeof value === 'function') {
      return (value as (...args: unknown[]) => unknown).bind(impl);
    }
    return value;
  },
});
