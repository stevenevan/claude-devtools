import { createTauriClient } from './tauriClient';

import type { ElectronAPI } from '@shared/types/api';

let client: ElectronAPI | null = null;

export async function initializeApi(): Promise<void> {
  if (!client) {
    client = createTauriClient();
  }
}

function getImpl(): ElectronAPI {
  if (!client) {
    client = createTauriClient();
  }
  return client;
}

export const isTauriMode = (): boolean => !!window.__TAURI_INTERNALS__;

export const isDesktopMode = (): boolean => true;

export const api: ElectronAPI = new Proxy({} as ElectronAPI, {
  get(_target, prop, receiver) {
    const impl = getImpl();
    const value = Reflect.get(impl, prop, receiver) as unknown;
    if (typeof value === 'function') {
      return (value as (...args: unknown[]) => unknown).bind(impl);
    }
    return value;
  },
});
