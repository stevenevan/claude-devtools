/**
 * Unified API adapter.
 *
 * Resolves the appropriate ElectronAPI implementation based on runtime:
 * 1. Electron: preload script exposes `window.electronAPI`
 * 2. Tauri: TauriAPIClient using native Rust invoke()
 *
 * All renderer code should import `api` from this module instead of
 * accessing `window.electronAPI` directly.
 */

import { TauriAPIClient } from './tauriClient';

import type { ElectronAPI } from '@shared/types/api';

let tauriClient: TauriAPIClient | null = null;

/**
 * Initialize the API client. In Tauri mode this is synchronous (no sidecar port needed).
 */
export async function initializeApi(): Promise<void> {
  if (window.__TAURI_INTERNALS__ && !tauriClient) {
    tauriClient = new TauriAPIClient();
  }
}

function getImpl(): ElectronAPI {
  // 1. Electron mode (preload bridge)
  if (window.electronAPI) return window.electronAPI;
  // 2. Tauri mode (native Rust commands)
  if (!tauriClient) {
    tauriClient = new TauriAPIClient();
  }
  return tauriClient;
}

/** True when running inside Electron (preload bridge available). */
export const isElectronMode = (): boolean => !!window.electronAPI;

/** True when running inside Tauri. */
export const isTauriMode = (): boolean => !!window.__TAURI_INTERNALS__;

/** True when running as a desktop app (Electron or Tauri), false for browser/standalone. */
export const isDesktopMode = (): boolean => !!window.electronAPI || !!window.__TAURI_INTERNALS__;

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
