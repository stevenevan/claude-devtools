import type { SessionDetail, SnapshotMeta, SnapshotsAPI } from '@shared/types';

import { call } from '../invoke';

// Snapshots slice (WailsAPI.snapshots, W9). Mirrors snapshotservice. `open`
// revives dates (returns a SessionDetail) exactly like the Wails adapter
// (domain/sessions.ts); list/create/delete do not.
export const snapshotsCommands: SnapshotsAPI = {
  list: (): Promise<SnapshotMeta[]> => call<SnapshotMeta[]>('snapshots_list'),
  createFromSession: (projectId, sessionId, label): Promise<SnapshotMeta> =>
    call<SnapshotMeta>('snapshots_create_from_session', {
      projectId,
      sessionId,
      label: label ?? null,
    }),
  delete: (snapshotId): Promise<void> => call<void>('snapshots_delete', { snapshotId }),
  open: (snapshotId): Promise<SessionDetail> =>
    call<SessionDetail>('snapshots_open', { snapshotId }, { reviveDates: true }),
};
