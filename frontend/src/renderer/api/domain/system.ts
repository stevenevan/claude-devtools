import { Application, Browser, Events, Window } from '@wailsio/runtime';

import {
  ContextGetActive,
  ContextList,
  ContextSwitch,
} from '../../../../bindings/claude-devtools/internal/sessionservice/sessionservice';
import {
  SshConnect,
  SshDisconnect,
  SshGetConfigHosts,
  SshGetLastConnection,
  SshGetState,
  SshResolveHost,
  SshSaveLastConnection,
  SshTest,
} from '../../../../bindings/claude-devtools/internal/sshservice/sshservice';
import {
  GetAppVersion,
  OpenPath,
} from '../../../../bindings/claude-devtools/internal/systemservice/systemservice';

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
  connect: (config) =>
    SshConnect(config as unknown as Parameters<typeof SshConnect>[0]) as unknown as Promise<SshConnectionStatus>,
  disconnect: () => SshDisconnect() as unknown as Promise<SshConnectionStatus>,
  getState: () => SshGetState() as unknown as Promise<SshConnectionStatus>,
  test: (config) =>
    SshTest(config as unknown as Parameters<typeof SshTest>[0]) as unknown as Promise<{
      success: boolean;
      error?: string;
    }>,
  getConfigHosts: () => SshGetConfigHosts() as unknown as Promise<SshConfigHostEntry[]>,
  resolveHost: (alias) =>
    SshResolveHost(alias) as unknown as Promise<SshConfigHostEntry | null>,
  saveLastConnection: (config) =>
    SshSaveLastConnection(config as unknown as Parameters<typeof SshSaveLastConnection>[0]),
  getLastConnection: () => SshGetLastConnection() as unknown as Promise<SshLastConnection | null>,
  onStatus: (callback) => {
    const off = Events.On('ssh-status', (e) => {
      callback(null, e.data as SshConnectionStatus);
    });
    return off;
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
  getAppVersion: (): Promise<string> => GetAppVersion(),

  getZoomFactor: async (): Promise<number> => 1.0,

  onZoomFactorChanged:
    (_callback: (zoomFactor: number) => void): (() => void) =>
    () => {},

  onFileChange: (callback: (event: FileChangeEvent) => void): (() => void) => {
    const off = Events.On('file-change', (e) => {
      callback(e.data as FileChangeEvent);
    });
    return off;
  },

  onTodoChange: (callback: (event: FileChangeEvent) => void): (() => void) => {
    const off = Events.On('todo-change', (e) => {
      callback(e.data as FileChangeEvent);
    });
    return off;
  },

  onSessionRefresh:
    (_callback: () => void): (() => void) =>
    () => {},

  openPath: async (
    targetPath: string,
    _projectRoot?: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      await OpenPath(targetPath);
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  openExternal: async (url: string): Promise<{ success: boolean; error?: string }> => {
    try {
      await Browser.OpenURL(url);
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  windowControls: {
    minimize: async (): Promise<void> => {
      await Window.Minimise();
    },
    maximize: async (): Promise<void> => {
      if (await Window.IsMaximised()) {
        await Window.UnMaximise();
      } else {
        await Window.Maximise();
      }
    },
    close: async (): Promise<void> => {
      await Window.Close();
    },
    isMaximized: async (): Promise<boolean> => Window.IsMaximised(),
    relaunch: async (): Promise<void> => {
      await Application.Quit();
    },
  },

  updater: updaterApi,

  ssh: sshApi,

  context: {
    list: (): Promise<ContextInfo[]> =>
      ContextList() as unknown as Promise<ContextInfo[]>,
    getActive: (): Promise<string> => ContextGetActive(),
    switch: (contextId: string): Promise<{ contextId: string }> =>
      ContextSwitch(contextId) as unknown as Promise<{ contextId: string }>,
    onChanged:
      (_callback: (event: unknown, data: ContextInfo) => void): (() => void) =>
      () => {},
  },

  httpServer: httpServerApi,
};
