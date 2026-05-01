/**
 * Plugin API surface (sprint 38).
 *
 * The host implements this contract; plugins consume it through the
 * sandbox bridge. `apiVersion` is a required field on every plugin
 * manifest — the host rejects mismatched majors.
 */

export const PLUGIN_API_VERSION = '1.0' as const;

export interface PluginPanelDescriptor {
  id: string;
  title: string;
  /** HTML rendered inside an iframe-safe slot (no React access). */
  html: string;
}

export interface PluginCommandDescriptor {
  id: string;
  label: string;
  /** Plugin-side handler key passed back to the worker on invocation. */
  handlerKey: string;
}

export interface PluginContextMenuItemDescriptor {
  id: string;
  label: string;
  surface: 'session-item' | 'annotation' | 'bookmark';
  handlerKey: string;
}

/** Allowed slice keys a plugin may subscribe to. Allowlist, not denylist. */
export type SubscribableSlice =
  | 'sessions'
  | 'activeSession'
  | 'annotations'
  | 'bookmarks'
  | 'snapshots';

export interface SubscriptionOptions {
  /** Plugin host enforces a 5-concurrent-subscription cap per plugin. */
  intervalMs?: number;
}

export interface PluginAPI {
  apiVersion: typeof PLUGIN_API_VERSION;
  registerPanel(descriptor: PluginPanelDescriptor): void;
  registerCommand(descriptor: PluginCommandDescriptor): void;
  registerContextMenuItem(descriptor: PluginContextMenuItemDescriptor): void;
  subscribeStoreSlice(
    slice: SubscribableSlice,
    options?: SubscriptionOptions
  ): { unsubscribe: () => void };
}

export interface PluginManifest {
  id: string;
  apiVersion: string;
  displayName?: string;
}

export class PluginDisposedError extends Error {
  constructor(pluginId: string) {
    super(`Plugin "${pluginId}" was disposed`);
    this.name = 'PluginDisposedError';
  }
}

export const SUBSCRIPTION_QUOTA = 5;
export const SUBSCRIPTION_PAYLOAD_LIMIT_BYTES = 64 * 1024;
export const TEARDOWN_TIMEOUT_MS = 100;
