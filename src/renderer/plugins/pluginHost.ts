/**
 * Plugin host (sprint 38) — lifecycle: load → execute → dispose.
 *
 * Loading creates a classic Worker, sends the capability preamble plus
 * the plugin source, and returns a handle. Disposal terminates the
 * worker within `TEARDOWN_TIMEOUT_MS` and rejects all pending RPCs.
 */

import { api } from '@renderer/api';
import { createLogger } from '@shared/utils/logger';

import { buildCapabilityPreamble } from './capabilityGate';
import { PLUGIN_API_VERSION, PluginDisposedError, TEARDOWN_TIMEOUT_MS } from './pluginApi';
import { SandboxBridge } from './sandboxBridge';

import type { PluginManifest } from './pluginApi';

const logger = createLogger('PluginHost');

export interface LoadedPlugin {
  manifest: PluginManifest;
  bridge: SandboxBridge;
  worker: Worker;
  /** Reject all pending RPCs and terminate the worker. */
  dispose: () => Promise<void>;
}

const loaded = new Map<string, LoadedPlugin>();

function buildBootstrap(source: string): string {
  return `${buildCapabilityPreamble()}
try {
  ${source}
} catch (err) {
  postMessage({ type: 'plugin-error', error: String(err && err.message ? err.message : err) });
}`;
}

function checkApiVersion(declared: string): void {
  const [declaredMajor] = declared.split('.');
  const [hostMajor] = PLUGIN_API_VERSION.split('.');
  if (declaredMajor !== hostMajor) {
    throw new Error(
      `Plugin apiVersion ${declared} does not match host major ${PLUGIN_API_VERSION}`
    );
  }
}

export async function loadPlugin(manifest: PluginManifest, source: string): Promise<LoadedPlugin> {
  checkApiVersion(manifest.apiVersion);

  const bridge = new SandboxBridge(manifest.id);
  const blob = new Blob([buildBootstrap(source)], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url, { type: 'classic' });

  const handle: LoadedPlugin = {
    manifest,
    bridge,
    worker,
    dispose: async () => {
      bridge.dispose();
      const terminated = new Promise<void>((resolve) => {
        worker.terminate();
        resolve();
      });
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, TEARDOWN_TIMEOUT_MS));
      await Promise.race([terminated, timeout]);
      URL.revokeObjectURL(url);
      loaded.delete(manifest.id);
    },
  };

  loaded.set(manifest.id, handle);
  return handle;
}

/** Fetch plugin metadata + source from disk via the Rust discovery
 * command. Returns an array of { id, path, source }. */
export async function discoverAndReadPlugins(): Promise<{ id: string; path: string }[]> {
  try {
    const entries = await api.plugins.list();
    return entries;
  } catch (error) {
    logger.error('plugin discovery failed', error);
    return [];
  }
}

export function getLoadedPlugin(id: string): LoadedPlugin | undefined {
  return loaded.get(id);
}

export function listLoadedPluginIds(): string[] {
  return Array.from(loaded.keys());
}

/** Dispose every loaded plugin. Used on app shutdown. */
export async function disposeAllPlugins(): Promise<void> {
  const all = Array.from(loaded.values());
  await Promise.all(all.map((p) => p.dispose()));
}

export { PluginDisposedError };
