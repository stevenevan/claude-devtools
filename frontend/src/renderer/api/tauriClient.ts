import { notificationEvents } from './tauri/domain/config';
import { maintenanceEvents } from './tauri/domain/maintenance';
import { contextEvents, sshEvents, systemEvents } from './tauri/domain/system';

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
    ssh: makeSlice({ ...sshEvents }, 'ssh'),
    context: makeSlice({ ...contextEvents }, 'context'),
    maintenance: makeSlice({ ...maintenanceEvents }, 'maintenance'),
    notifications: makeSlice({ ...notificationEvents }, 'notifications'),
    config: makeSlice({}, 'config'),
    session: makeSlice({}, 'session'),
    snapshots: makeSlice({}, 'snapshots'),
    plugins: makeSlice({}, 'plugins'),
    webhook: makeSlice({}, 'webhook'),
    windowControls: makeSlice({}, 'windowControls'),
    updater: makeSlice({}, 'updater'),
    httpServer: makeSlice({}, 'httpServer'),
  };
  return makeSlice<WailsAPI>(real, '');
}
