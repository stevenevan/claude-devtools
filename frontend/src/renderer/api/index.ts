import { createWailsClient } from './wailsClient';

import type { WailsAPI } from '@shared/types/api';

let client: WailsAPI | null = null;

export async function initializeApi(): Promise<void> {
  if (!client) {
    client = createWailsClient();
  }
}

function getImpl(): WailsAPI {
  if (!client) {
    client = createWailsClient();
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
