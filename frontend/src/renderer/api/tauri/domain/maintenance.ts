import type { MaintenanceScanProgress } from '@shared/types';

import { bridgeEvent } from '../eventBridge';

// Event wirings owned by the Wails "maintenance" adapter, ported to Tauri
// `listen`. Payload shapes mirror the current Wails adapter exactly.
export const maintenanceEvents = {
  onScanProgress: (callback: (progress: MaintenanceScanProgress) => void): (() => void) =>
    bridgeEvent<MaintenanceScanProgress>('maintenance:scan-progress', callback),
  onMuteWatcher: (callback: (muted: boolean) => void): (() => void) =>
    bridgeEvent<{ muted: boolean }>('maintenance:mute-watcher', (data) => callback(data.muted)),
  onTrashed: (callback: (projects: string[]) => void): (() => void) =>
    bridgeEvent<{ projects: string[] }>('maintenance:trashed', (data) => callback(data.projects)),
  onConfigFileChange: (callback: (path?: string) => void): (() => void) =>
    bridgeEvent<{ path?: string } | undefined>('config-file-change', (data) =>
      callback(data?.path)
    ),
};
