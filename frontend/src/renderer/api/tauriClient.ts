import { analyticsCommands } from './tauri/domain/analytics';
import { configApi, notificationEvents } from './tauri/domain/config';
import { filesCommands } from './tauri/domain/files';
import { insightsCommands } from './tauri/domain/insights';
import { maintenanceCommands, maintenanceEvents } from './tauri/domain/maintenance';
import { sessionCommands } from './tauri/domain/session';
import { snapshotsCommands } from './tauri/domain/snapshots';
import { sshCommands } from './tauri/domain/ssh';
import { contextEvents, sshEvents, systemCommands, systemEvents } from './tauri/domain/system';
import { timingCommands } from './tauri/domain/timing';

import type { WailsAPI } from '@shared/types/api';

// A Proxy over the real (wired) methods of a WailsAPI slice: present keys return
// the real implementation; any other method access throws a clear "not ported
// yet" error. Lets a slice mix its few real (event) methods with the many data
// methods a later week ports, without hand-writing ~200 stubs. Everything is
// cast because the Tauri backend is filled in week by week — the same escape
// hatch api/index.ts already uses with its `new Proxy({} as WailsAPI, …)`.
function makeSlice<T extends object>(real: Record<string, unknown>, name: string): T {
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      if (typeof prop === 'symbol') return undefined;
      const label = name ? `${name}.${String(prop)}` : String(prop);
      return () => {
        throw new Error(`Tauri backend: ${label} not ported yet`);
      };
    },
  }) as unknown as T;
}

// Returns the SAME WailsAPI contract as createWailsClient(). In Cycle A only the
// event subscriptions are wired (via the Tauri listen bridge); every data method
// throws notPorted until its porting week (W3+). Never reached while the default
// backend stays Wails.
export function createTauriClient(): WailsAPI {
  const real: Record<string, unknown> = {
    ...systemEvents,
    ...sessionCommands, // flat session data methods (getSessionDetail, …) — W7
    ...analyticsCommands, // flat analytics data methods (getAnalytics, …) — W8
    ...timingCommands, // flat backend-observability methods (getBackendTimings, …) — W8
    ...insightsCommands, // flat insights data methods (getToolAnalytics, …) — W9
    ...systemCommands, // flat system data methods (getAppVersion, openPath, …) — W11
    ...filesCommands, // flat FilesService methods (validatePath, getMCPStatus, …) — W12
    ssh: makeSlice({ ...sshEvents, ...sshCommands }, 'ssh'), // W11 data + W02 onStatus
    context: makeSlice({ ...contextEvents }, 'context'),
    maintenance: makeSlice({ ...maintenanceEvents, ...maintenanceCommands }, 'maintenance'),
    notifications: makeSlice({ ...notificationEvents }, 'notifications'),
    config: makeSlice({ ...configApi }, 'config'),
    session: makeSlice({}, 'session'),
    snapshots: makeSlice({ ...snapshotsCommands }, 'snapshots'),
    plugins: makeSlice({}, 'plugins'),
    webhook: makeSlice({}, 'webhook'),
    windowControls: makeSlice({}, 'windowControls'),
    updater: makeSlice({}, 'updater'),
    httpServer: makeSlice({}, 'httpServer'),
  };
  return makeSlice<WailsAPI>(real, '');
}
