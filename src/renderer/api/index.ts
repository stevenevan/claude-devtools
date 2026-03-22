/**
 * Unified API adapter.
 *
 * Resolves the appropriate ElectronAPI implementation based on runtime:
 * 1. Electron: preload script exposes `window.electronAPI`
 * 2. Tauri: `window.__TAURI_INTERNALS__` detected → TauriAPIClient (native + HTTP sidecar)
 * 3. Browser: HTTP+SSE client for standalone/Docker mode
 *
 * All renderer code should import `api` from this module instead of
 * accessing `window.electronAPI` directly.
 *
 * The instance is resolved lazily on first property access so that test code
 * can install mocks on `window.electronAPI` before the adapter resolves.
 *
 * In Tauri mode, call `initializeApi()` before rendering to resolve
 * the sidecar port asynchronously (window.__SIDECAR_PORT__ may not be
 * available synchronously due to webview navigation).
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

/**
 * Resolves the sidecar port and creates the TauriAPIClient.
 * Must be called (and awaited) before React renders in Tauri mode.
 */
export async function initializeApi(): Promise<void> {
  if (window.__TAURI_INTERNALS__ && !tauriClient) {
    const client = await TauriAPIClient.create();
    if (client) {
      tauriClient = client;
    }
  }
}

function getImpl(): ElectronAPI {
  // 1. Electron mode (preload bridge)
  if (window.electronAPI) return window.electronAPI;
  // 2. Tauri mode (sidecar + native plugins)
  if (window.__TAURI_INTERNALS__) {
    if (tauriClient) {
      return tauriClient;
    }
    // Fallback: port available synchronously (production builds)
    if (window.__SIDECAR_PORT__) {
      tauriClient = new TauriAPIClient(window.__SIDECAR_PORT__);
      return tauriClient;
    }
    // initializeApi() was not awaited — fall through to browser mode
    // so the app can at least render without crashing
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
