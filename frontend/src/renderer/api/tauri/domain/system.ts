import type {
  AggregatedSessionTodos,
  ContextInfo,
  FileChangeEvent,
  SshConnectionStatus,
} from '@shared/types';

import { bridgeEvent } from '../eventBridge';
import { call } from '../invoke';

// Flat system data methods (WailsAPI top-level, W11). Mirror systemservice's
// GetAppVersion / OpenPath / GetAllTodos. No reviveDates (no Date fields).
export const systemCommands = {
  getAppVersion: (): Promise<string> => call<string>('get_app_version'),
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
};

// Event wirings owned by the Wails "system" adapter, ported to Tauri `listen`.
// Data methods (getAppVersion, openPath, windowControls, …) are ported by later
// weeks and route to notPorted via makeSlice in tauriClient.

export const systemEvents = {
  onFileChange: (callback: (event: FileChangeEvent) => void): (() => void) =>
    bridgeEvent<FileChangeEvent>('file-change', callback),
  onTodoChange: (callback: (event: FileChangeEvent) => void): (() => void) =>
    bridgeEvent<FileChangeEvent>('todo-change', callback),
  // No backing event today — the Wails client stubs these too. Do NOT invent a name.
  onZoomFactorChanged: (_callback: (zoomFactor: number) => void): (() => void) => () => {},
  onSessionRefresh: (_callback: () => void): (() => void) => () => {},
};

export const sshEvents = {
  onStatus: (callback: (event: unknown, data: SshConnectionStatus) => void): (() => void) =>
    bridgeEvent<SshConnectionStatus>('ssh-status', (data) => callback(null, data)),
};

// No backing event today (Wails no-op) — matches current behavior.
export const contextEvents = {
  onChanged: (_callback: (event: unknown, data: ContextInfo) => void): (() => void) => () => {},
};
