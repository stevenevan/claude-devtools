import type { BackendCacheStats, BackendTimingSummary } from '@shared/types';

import { call } from '../invoke';

// Flat backend-observability methods (DesktopAPI top-level, W8). Mirror
// timingservice.GetBackendTimings/GetCacheStats/SetCacheCapacity/ClearSessionCache.
// No reviveDates (the legacy adapter revives none of these).
export const timingCommands = {
  getBackendTimings: (limit?: number): Promise<BackendTimingSummary[]> =>
    call<BackendTimingSummary[]>('get_backend_timings', { limit: limit ?? null }),
  getCacheStats: (): Promise<BackendCacheStats> => call<BackendCacheStats>('get_cache_stats'),
  setCacheCapacity: (capacity: number): Promise<void> =>
    call<void>('set_cache_capacity', { capacity }),
  clearSessionCache: (): Promise<void> => call<void>('clear_session_cache'),
};
