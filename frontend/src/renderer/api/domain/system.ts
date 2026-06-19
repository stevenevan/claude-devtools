import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { openPath as openPathPlugin, openUrl } from '@tauri-apps/plugin-opener';
import { relaunch } from '@tauri-apps/plugin-process';

import type {
  ContextInfo,
  ElectronAPI,
  FileChangeEvent,
  HttpServerAPI,
  HttpServerStatus,
  SshAPI,
  SshConfigHostEntry,
  SshConnectionStatus,
  SshLastConnection,
  UpdaterAPI,
} from '@shared/types';

type SystemSlice = Pick<
  ElectronAPI,
  | 'getAppVersion'
  | 'getZoomFactor'
  | 'onZoomFactorChanged'
  | 'onFileChange'
  | 'onTodoChange'
  | 'onSessionRefresh'
  | 'openPath'
  | 'openExternal'
  | 'windowControls'
  | 'updater'
  | 'ssh'
  | 'context'
  | 'httpServer'
>;

const sshApi: SshAPI = {
  connect: (config) => invoke<SshConnectionStatus>('ssh_connect', { config }),
  disconnect: () => invoke<SshConnectionStatus>('ssh_disconnect'),
  getState: () => invoke<SshConnectionStatus>('ssh_get_state'),
  test: (config) => invoke<{ success: boolean; error?: string }>('ssh_test', { config }),
  getConfigHosts: () => invoke<SshConfigHostEntry[]>('ssh_get_config_hosts'),
  resolveHost: (alias) => invoke<SshConfigHostEntry | null>('ssh_resolve_host', { alias }),
  saveLastConnection: (config) => invoke('ssh_save_last_connection', { config }),
  getLastConnection: () => invoke<SshLastConnection | null>('ssh_get_last_connection'),
  onStatus: (callback) => {
    let unlisten: UnlistenFn | null = null;
    void listen<SshConnectionStatus>('ssh-status', (event) => {
      callback(null, event.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  },
};

const httpServerApi: HttpServerAPI = {
  start: (): Promise<HttpServerStatus> => Promise.resolve({ running: true, port: 0 }),
  stop: (): Promise<HttpServerStatus> => Promise.resolve({ running: true, port: 0 }),
  getStatus: (): Promise<HttpServerStatus> => Promise.resolve({ running: true, port: 0 }),
};

const updaterApi: UpdaterAPI = {
  check: async (): Promise<void> => {},
  download: async (): Promise<void> => {},
  install: async (): Promise<void> => {},
  onStatus:
    (_callback): (() => void) =>
    () => {},
};

export const systemApi: SystemSlice = {
  getAppVersion: (): Promise<string> => getVersion(),

  getZoomFactor: async (): Promise<number> => 1.0,

  onZoomFactorChanged:
    (_callback: (zoomFactor: number) => void): (() => void) =>
    () => {},

  onFileChange: (callback: (event: FileChangeEvent) => void): (() => void) => {
    let unlisten: UnlistenFn | null = null;
    void listen<FileChangeEvent>('file-change', (tauriEvent) => {
      callback(tauriEvent.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  },

  onTodoChange: (callback: (event: FileChangeEvent) => void): (() => void) => {
    let unlisten: UnlistenFn | null = null;
    void listen<FileChangeEvent>('todo-change', (tauriEvent) => {
      callback(tauriEvent.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  },

  onSessionRefresh:
    (_callback: () => void): (() => void) =>
    () => {},

  openPath: async (
    targetPath: string,
    _projectRoot?: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      await openPathPlugin(targetPath);
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  openExternal: async (url: string): Promise<{ success: boolean; error?: string }> => {
    try {
      await openUrl(url);
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  windowControls: {
    minimize: async (): Promise<void> => {
      await getCurrentWindow().minimize();
    },
    maximize: async (): Promise<void> => {
      const win = getCurrentWindow();
      if (await win.isMaximized()) {
        await win.unmaximize();
      } else {
        await win.maximize();
      }
    },
    close: async (): Promise<void> => {
      await getCurrentWindow().close();
    },
    isMaximized: async (): Promise<boolean> => getCurrentWindow().isMaximized(),
    relaunch: async (): Promise<void> => {
      await relaunch();
    },
  },

  updater: updaterApi,

  ssh: sshApi,

  context: {
    list: (): Promise<ContextInfo[]> => invoke('context_list'),
    getActive: (): Promise<string> => invoke('context_get_active'),
    switch: (contextId: string): Promise<{ contextId: string }> =>
      invoke('context_switch', { contextId }),
    onChanged:
      (_callback: (event: unknown, data: ContextInfo) => void): (() => void) =>
      () => {},
  },

  httpServer: httpServerApi,
};
