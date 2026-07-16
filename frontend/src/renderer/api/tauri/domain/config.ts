import { bridgeEvent } from '../eventBridge';

// Notification event wirings owned by the Wails "config" adapter, ported to
// Tauri `listen`. Two-arg WailsAPI callbacks `(event, data)` are fed `null` as
// the leading event arg, matching the current Wails adapter.
export const notificationEvents = {
  onNew: (callback: (event: unknown, error: unknown) => void): (() => void) =>
    bridgeEvent<unknown>('notification:new', (data) => callback(null, data)),
  onUpdated: (
    callback: (event: unknown, payload: { total: number; unreadCount: number }) => void
  ): (() => void) =>
    bridgeEvent<{ total: number; unreadCount: number }>('notification:updated', (data) =>
      callback(null, data)
    ),
  onClicked: (callback: (event: unknown, data: unknown) => void): (() => void) =>
    bridgeEvent<unknown>('notification:clicked', (data) => callback(null, data)),
};
