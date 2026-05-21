// Snapshots API (sprint 36)

import type { SessionDetail } from '../chunks';

export interface SnapshotMeta {
  id: string;
  label: string;
  sourceSessionId: string;
  sourceProjectId: string;
  createdAt: number;
  messageCount: number;
  chunkCount: number;
  sizeBytes: number;
}

export interface SnapshotsAPI {
  list: () => Promise<SnapshotMeta[]>;
  createFromSession: (
    projectId: string,
    sessionId: string,
    label?: string
  ) => Promise<SnapshotMeta>;
  delete: (snapshotId: string) => Promise<void>;
  open: (snapshotId: string) => Promise<SessionDetail>;
}
