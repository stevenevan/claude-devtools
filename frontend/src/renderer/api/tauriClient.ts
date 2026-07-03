import { analyticsApi } from './domain/analytics';
import { configApi } from './domain/config';
import { filesApi } from './domain/files';
import { maintenanceApi } from './domain/maintenance';
import { sessionsApi } from './domain/sessions';
import { systemApi } from './domain/system';

import type { ElectronAPI } from '@shared/types/api';

export function createTauriClient(): ElectronAPI {
  return {
    ...sessionsApi,
    ...analyticsApi,
    ...configApi,
    ...filesApi,
    ...systemApi,
    ...maintenanceApi,
  };
}
