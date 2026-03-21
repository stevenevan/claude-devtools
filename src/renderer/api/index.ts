/**
 * Unified API adapter.
 *
 * Resolves the appropriate ElectronAPI implementation based on runtime:
 * 1. Electron: preload script exposes `window.electronAPI`
 * 2. Tauri: `window.__TAURI__` detected → TauriAPIClient (native + HTTP sidecar)
 * 3. Browser: HTTP+SSE client for standalone/Docker mode
 *
 * All renderer code should import `api` from this module instead of
 * accessing `window.electronAPI` directly.
 *
 * The instance is resolved lazily on first property access so that test code
 * can install mocks on `window.electronAPI` before the adapter resolves.
 */

import { HttpAPIClient } from './httpClient';
import { TauriAPIClient } from './tauriClient';

import type { ElectronAPI } from '@shared/types/api';

/**
 * Resolves the base URL for the HTTP API client.
 *
 * - Electron "server mode" (browser opened via ?port=XXXX): use explicit port on 127.0.0.1
 * - Standalone/Docker (page served by the same server): use window.location.origin
 *   to avoid cross-origin issues (localhost vs 127.0.0.1)
 */
function getHttpBaseUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const explicitPort = params.get('port');
  if (explicitPort) {
    return `http://127.0.0.1:${parseInt(explicitPort, 10)}`;
  }
  return window.location.origin;
}

let httpClient: HttpAPIClient | null = null;
let tauriClient: TauriAPIClient | null = null;

function getImpl(): ElectronAPI {
  // 1. Electron mode (preload bridge)
  if (window.electronAPI) return window.electronAPI;
  // 2. Tauri mode (sidecar + native plugins)
  if (window.__TAURI__) {
    if (!tauriClient) {
      tauriClient = new TauriAPIClient(window.__SIDECAR_PORT__);
    }
    return tauriClient;
  }
  // 3. Browser/standalone mode (pure HTTP+SSE)
  if (!httpClient) {
    httpClient = new HttpAPIClient(getHttpBaseUrl());
  }
  return httpClient;
}

/** True when running inside Electron (preload bridge available). */
export const isElectronMode = (): boolean => !!window.electronAPI;

/** True when running inside Tauri. */
export const isTauriMode = (): boolean => !!window.__TAURI__;

/** True when running as a desktop app (Electron or Tauri), false for browser/standalone. */
export const isDesktopMode = (): boolean => !!window.electronAPI || !!window.__TAURI__;

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
