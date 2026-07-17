import { beforeAll, expect, mock, test } from 'bun:test';

// The event bridge calls `@tauri-apps/api/event` `listen`, which is absent in the
// bun-test runtime. Stub it so event subscriptions resolve instead of throwing
// for the WRONG reason — this gate asserts the only failure it cares about is the
// `createTauriClient` "not ported yet" thrower, per week's PORTED allowlist.
mock.module('@tauri-apps/api/event', () => ({
  listen: async () => () => {},
  emit: async () => {},
}));

// Data methods route through `invoke`, also absent in the bun runtime — stub it
// so a wired data method resolves instead of throwing an invoke error.
mock.module('@tauri-apps/api/core', () => ({
  invoke: async () => null,
}));

const NOT_PORTED = /not ported yet/;

// PORTED allowlist — grows each porting week. W3: events only (wired via the
// Tauri `listen` bridge in Cycle A). W7 adds the flat session + search data
// methods (getSessionDetail, searchSessions, …).
const PORTED: Array<[string, (api: any) => unknown]> = [
  ['onFileChange', (a) => a.onFileChange(() => {})],
  ['onTodoChange', (a) => a.onTodoChange(() => {})],
  ['onZoomFactorChanged', (a) => a.onZoomFactorChanged(() => {})],
  ['onSessionRefresh', (a) => a.onSessionRefresh(() => {})],
  ['ssh.onStatus', (a) => a.ssh.onStatus(() => {})],
  ['context.onChanged', (a) => a.context.onChanged(() => {})],
  ['maintenance.onScanProgress', (a) => a.maintenance.onScanProgress(() => {})],
  ['maintenance.onMuteWatcher', (a) => a.maintenance.onMuteWatcher(() => {})],
  ['maintenance.onTrashed', (a) => a.maintenance.onTrashed(() => {})],
  ['maintenance.onConfigFileChange', (a) => a.maintenance.onConfigFileChange(() => {})],
  ['notifications.onNew', (a) => a.notifications.onNew(() => {})],
  ['notifications.onUpdated', (a) => a.notifications.onUpdated(() => {})],
  ['notifications.onClicked', (a) => a.notifications.onClicked(() => {})],
  // W7: first flat data method wired via the invoke bridge.
  ['getSessionDetail', (a) => a.getSessionDetail('p', 's')],
  // W8: flat analytics + backend-observability methods.
  ['getAnalytics', (a) => a.getAnalytics(30)],
  ['getCostForecast', (a) => a.getCostForecast(14)],
  ['getProductivityMetrics', (a) => a.getProductivityMetrics(30)],
  ['getSessionDurationStats', (a) => a.getSessionDurationStats(30)],
  ['getModelComparison', (a) => a.getModelComparison(30)],
  ['getBackendTimings', (a) => a.getBackendTimings()],
  ['getCacheStats', (a) => a.getCacheStats()],
  ['setCacheCapacity', (a) => a.setCacheCapacity(100)],
  ['clearSessionCache', (a) => a.clearSessionCache()],
  // W9: insights methods (closes the W8 deferral) + snapshots slice.
  ['getFileGraph', (a) => a.getFileGraph('p', 's')],
  ['getToolAnalytics', (a) => a.getToolAnalytics('p', 30)],
  ['getToolTimeHeatmap', (a) => a.getToolTimeHeatmap('p', 30)],
  ['getErrorHotspots', (a) => a.getErrorHotspots('p', 30, 2)],
  ['getErrorClusters', (a) => a.getErrorClusters('p', 30, 2)],
  ['snapshots.list', (a) => a.snapshots.list()],
  ['snapshots.createFromSession', (a) => a.snapshots.createFromSession('p', 's')],
  ['snapshots.delete', (a) => a.snapshots.delete('id')],
  ['snapshots.open', (a) => a.snapshots.open('id')],
  // W11: ssh slice data methods + flat system methods.
  ['ssh.connect', (a) => a.ssh.connect({})],
  ['ssh.disconnect', (a) => a.ssh.disconnect()],
  ['ssh.getState', (a) => a.ssh.getState()],
  ['ssh.test', (a) => a.ssh.test({})],
  ['ssh.getConfigHosts', (a) => a.ssh.getConfigHosts()],
  ['ssh.resolveHost', (a) => a.ssh.resolveHost('h')],
  ['ssh.saveLastConnection', (a) => a.ssh.saveLastConnection({})],
  ['ssh.getLastConnection', (a) => a.ssh.getLastConnection()],
  ['getAppVersion', (a) => a.getAppVersion()],
  ['openPath', (a) => a.openPath('/x')],
  ['getAllTodos', (a) => a.getAllTodos([])],
];

let createTauriClient: () => any;
beforeAll(async () => {
  ({ createTauriClient } = await import('./tauriClient'));
});

test('every PORTED key resolves to a non-thrower (not the notPorted stub)', () => {
  const api = createTauriClient();
  const broken: string[] = [];
  for (const [name, call] of PORTED) {
    try {
      call(api);
    } catch (e) {
      if (NOT_PORTED.test(String((e as Error).message))) broken.push(name);
    }
  }
  expect(broken).toEqual([]);
});

test('an un-ported data method still throws notPorted (gate detects gaps)', () => {
  const api = createTauriClient();
  // getSessionMetrics is a flat WailsAPI method not yet wired — must still throw.
  expect(() => api.getSessionMetrics('p', 's')).toThrow(NOT_PORTED);
});

