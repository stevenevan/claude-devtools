import { api } from '@renderer/api';
import { isDriftAlertEnabledForPath } from '@renderer/utils/driftAlertPrefs';
import { createLogger } from '@shared/utils/logger';

import { isWatcherMuted } from './maintenance';

import type { ListenerContext } from './types';

const logger = createLogger('Listeners:configDrift');

const HOUR_MS = 60 * 60 * 1000;

// Per-file last-alerted hour bucket. The backend also dedups on a synthetic
// ToolUseID ("config-drift:<file>:<hourBucket>"), but debouncing here spares
// the round-trip for the CLI's constant same-hour rewrites.
const lastAlertedHour = new Map<string, number>();

export function attachConfigDriftListeners(ctx: ListenerContext): void {
  if (!api.maintenance?.onConfigFileChange) return;

  const cleanup = api.maintenance.onConfigFileChange((path) => {
    if (!path) return;
    // Skip the app's OWN writes: bulk maintenance mutes the watcher around them.
    if (isWatcherMuted()) return;
    if (!isDriftAlertEnabledForPath(path)) return;

    const hourBucket = Math.floor(Date.now() / HOUR_MS);
    if (lastAlertedHour.get(path) === hourBucket) return;
    lastAlertedHour.set(path, hourBucket);

    void api.notifications.raiseConfigDrift(path, hourBucket, 0).catch((err) => {
      logger.error('Failed to raise config-drift alert:', err);
    });
  });

  if (typeof cleanup === 'function') {
    ctx.cleanupFns.push(cleanup);
  }
}
