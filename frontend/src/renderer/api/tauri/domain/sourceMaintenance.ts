import type {
  CheckpointMutationResult,
  DesktopAPI,
  MaintenancePage,
  RecoveryCopy,
  ShellSnapshotDetail,
  ShellSnapshotItem,
  SourceCheckpointDetail,
  SourceCheckpointGroup,
  SourceKind,
  SourceMaintenanceStatus,
  TelemetryDetail,
  TelemetryItem,
  UsageSummary,
} from '@shared/types/api';

import { call } from '../invoke';

type SourceMaintenanceSlice = Pick<
  DesktopAPI,
  | 'getSourceMaintenanceStatus'
  | 'readSourceUsageSummary'
  | 'listSourceTelemetry'
  | 'readSourceTelemetry'
  | 'listSourceFileHistory'
  | 'readSourceCheckpoint'
  | 'resolveSourceCheckpointOrigins'
  | 'listSourceShellSnapshots'
  | 'readSourceShellSnapshot'
  | 'saveSourceCheckpointViaDialog'
  | 'restoreSourceCheckpoint'
  | 'listCheckpointRecoveryCopies'
  | 'restoreCheckpointRecoveryCopy'
  | 'deleteCheckpointRecoveryCopy'
>;

export const sourceMaintenanceCommands: SourceMaintenanceSlice = {
  getSourceMaintenanceStatus: (sourceKind: SourceKind): Promise<SourceMaintenanceStatus> =>
    call<SourceMaintenanceStatus>('get_source_maintenance_status', { sourceKind }),

  readSourceUsageSummary: (sourceKind: SourceKind): Promise<UsageSummary> =>
    call<UsageSummary>('read_source_usage_summary', { sourceKind }),

  listSourceTelemetry: (
    sourceKind: SourceKind,
    cursor: string | null,
    limit: number
  ): Promise<MaintenancePage<TelemetryItem>> =>
    call<MaintenancePage<TelemetryItem>>('list_source_telemetry', { sourceKind, cursor, limit }),

  readSourceTelemetry: (sourceKind: SourceKind, id: string): Promise<TelemetryDetail> =>
    call<TelemetryDetail>('read_source_telemetry', { sourceKind, id }),

  listSourceFileHistory: (
    sourceKind: SourceKind,
    cursor: string | null,
    limit: number
  ): Promise<MaintenancePage<SourceCheckpointGroup>> =>
    call<MaintenancePage<SourceCheckpointGroup>>('list_source_file_history', {
      sourceKind,
      cursor,
      limit,
    }),

  readSourceCheckpoint: (
    sourceKind: SourceKind,
    sessionUuid: string,
    fileHash: string,
    version: number
  ): Promise<SourceCheckpointDetail> =>
    call<SourceCheckpointDetail>('read_source_checkpoint', {
      sourceKind,
      sessionUuid,
      fileHash,
      version,
    }),

  resolveSourceCheckpointOrigins: (
    sourceKind: SourceKind,
    sessionUuid: string,
    fileHashes: string[]
  ) =>
    call<Record<string, SourceCheckpointGroup['origin']>>('resolve_source_checkpoint_origins', {
      sourceKind,
      sessionUuid,
      fileHashes,
    }),

  listSourceShellSnapshots: (
    sourceKind: SourceKind,
    cursor: string | null,
    limit: number
  ): Promise<MaintenancePage<ShellSnapshotItem>> =>
    call<MaintenancePage<ShellSnapshotItem>>('list_source_shell_snapshots', {
      sourceKind,
      cursor,
      limit,
    }),

  readSourceShellSnapshot: (
    sourceKind: SourceKind,
    name: string
  ): Promise<ShellSnapshotDetail> =>
    call<ShellSnapshotDetail>('read_source_shell_snapshot', { sourceKind, name }),

  saveSourceCheckpointViaDialog: (
    sourceKind: SourceKind,
    sessionUuid: string,
    fileHash: string,
    version: number
  ): Promise<CheckpointMutationResult> =>
    call<CheckpointMutationResult>('save_source_checkpoint_via_dialog', {
      sourceKind,
      sessionUuid,
      fileHash,
      version,
    }),

  restoreSourceCheckpoint: (
    sourceKind: SourceKind,
    sessionUuid: string,
    fileHash: string,
    version: number
  ): Promise<CheckpointMutationResult> =>
    call<CheckpointMutationResult>('restore_source_checkpoint', {
      sourceKind,
      sessionUuid,
      fileHash,
      version,
    }),

  listCheckpointRecoveryCopies: (sourceKind: SourceKind): Promise<RecoveryCopy[]> =>
    call<RecoveryCopy[]>('list_checkpoint_recovery_copies', { sourceKind }),

  restoreCheckpointRecoveryCopy: (
    sourceKind: SourceKind,
    id: string
  ): Promise<CheckpointMutationResult> =>
    call<CheckpointMutationResult>('restore_checkpoint_recovery_copy', { sourceKind, id }),

  deleteCheckpointRecoveryCopy: (
    sourceKind: SourceKind,
    id: string
  ): Promise<CheckpointMutationResult> =>
    call<CheckpointMutationResult>('delete_checkpoint_recovery_copy', { sourceKind, id }),
};
