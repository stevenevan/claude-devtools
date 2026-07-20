import type {
  AggregatedSessionTodos,
  ContextInfo,
  FileChangeEvent,
  HttpServerAPI,
  HttpServerStatus,
  SshConnectionStatus,
  UpdaterAPI,
  DesktopAPI,
} from '@shared/types';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { openUrl } from '@tauri-apps/plugin-opener';

import { bridgeEvent } from '../eventBridge';
import { call } from '../invoke';

type SystemCommands = Pick<
  DesktopAPI,
  | 'getAppVersion'
  | 'getZoomFactor'
  | 'openPath'
  | 'openExternal'
  | 'getAllTodos'
  | 'windowControls'
  | 'updater'
  | 'context'
  | 'httpServer'
>;

const httpServer: HttpServerAPI = {
  start: async (): Promise<HttpServerStatus> => ({ running: true, port: 0 }),
  stop: async (): Promise<HttpServerStatus> => ({ running: true, port: 0 }),
  getStatus: async (): Promise<HttpServerStatus> => ({ running: true, port: 0 }),
};

const updater: UpdaterAPI = {
  check: async (): Promise<void> => {},
  download: async (): Promise<void> => {},
  install: async (): Promise<void> => {},
  onStatus: () => () => {},
};

function validExternalUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

// Flat system data methods. Native methods preserve legacy' no-op updater,
// context, and HTTP-server behavior while moving dialog/window/url calls to Tauri.
export const systemCommands: SystemCommands = {
  getAppVersion: (): Promise<string> => call<string>('get_app_version'),
  getZoomFactor: async (): Promise<number> => 1,
  openPath: (
    targetPath: string,
    projectRoot?: string
  ): Promise<{ success: boolean; error?: string }> =>
    call<{ success: boolean; error?: string }>('open_path', {
      targetPath,
      projectRoot: projectRoot ?? null,
    }),
  getAllTodos: (projectIds: string[]): Promise<AggregatedSessionTodos[]> =>
    call<AggregatedSessionTodos[]>('get_all_todos', { projectIds }),
  openExternal: async (value) => {
    const url = validExternalUrl(value);
    if (!url) return { success: false, error: 'invalid external URL' };
    try {
      await openUrl(url);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
  windowControls: {
    minimize: () => getCurrentWindow().minimize(),
    maximize: async () => {
      const window = getCurrentWindow();
      if (await window.isMaximized()) await window.unmaximize();
      else await window.maximize();
    },
    close: () => getCurrentWindow().close(),
    isMaximized: () => getCurrentWindow().isMaximized(),
    relaunch: () => call<void>('quit_app'),
  },
  updater,
  context: {
    list: async (): Promise<ContextInfo[]> => [{ id: 'local', type: 'local' }],
    getActive: async (): Promise<string> => 'local',
    switch: async (contextId: string): Promise<{ contextId: string }> => ({ contextId }),
    onChanged: () => () => {},
  },
  httpServer,
};

// Event wirings owned by the legacy "system" adapter, ported to Tauri `listen`.
// Data methods (getAppVersion, openPath, windowControls, …) are ported by later
// weeks and route to notPorted via makeSlice in tauriClient.

export const systemEvents = {
  onFileChange: (callback: (event: FileChangeEvent) => void): (() => void) =>
    bridgeEvent<FileChangeEvent>('file-change', callback),
  onTodoChange: (callback: (event: FileChangeEvent) => void): (() => void) =>
    bridgeEvent<FileChangeEvent>('todo-change', callback),
  // No backing event today — the legacy client stubs these too. Do NOT invent a name.
  onZoomFactorChanged: (_callback: (zoomFactor: number) => void): (() => void) => () => {},
  onSessionRefresh: (_callback: () => void): (() => void) => () => {},
};

export const sshEvents = {
  onStatus: (callback: (event: unknown, data: SshConnectionStatus) => void): (() => void) =>
    bridgeEvent<SshConnectionStatus>('ssh-status', (data) => callback(null, data)),
};

// No backing event today (legacy no-op) — matches current behavior.
export const contextEvents = {
  onChanged: (_callback: (event: unknown, data: ContextInfo) => void): (() => void) => () => {},
};
