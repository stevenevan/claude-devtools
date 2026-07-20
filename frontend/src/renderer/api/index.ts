import { createTauriClient } from './tauriClient';

import type { DesktopAPI } from '@shared/types/api';

let client: DesktopAPI | null = null;

function createClient(): DesktopAPI {
  return createTauriClient();
}

export async function initializeApi(): Promise<void> {
  if (!client) {
    client = createClient();
  }
}

function getImpl(): DesktopAPI {
  if (!client) {
    client = createClient();
  }
  return client;
}

export const isDesktopMode = (): boolean => true;

export const api: DesktopAPI = new Proxy({} as DesktopAPI, {
  get(_target, prop, receiver) {
    const impl = getImpl();
    const value = Reflect.get(impl, prop, receiver) as unknown;
    if (typeof value === 'function') {
      return (value as (...args: unknown[]) => unknown).bind(impl);
    }
    return value;
  },
});
