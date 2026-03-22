/**
 * API adapter — provides access to the Tauri Rust backend.
 *
 * All renderer code should import `api` from this module.
 */

import { TauriAPIClient } from './tauriClient';

import type { ElectronAPI } from '@shared/types/api';

let client: TauriAPIClient | null = null;

/** Initialize the API client. */
export async function initializeApi(): Promise<void> {
  if (!client) {
    client = new TauriAPIClient();
  }
}

function getImpl(): ElectronAPI {
  if (!client) {
    client = new TauriAPIClient();
  }
  return client;
}

/** True when running inside Tauri. */
export const isTauriMode = (): boolean => !!window.__TAURI_INTERNALS__;

/** True when running as a desktop app. */
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
