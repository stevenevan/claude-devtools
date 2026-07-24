import type { CheckpointGroup, DesktopAPI, FileMeta, HistoryPage } from '@shared/types/api';

import { call } from '../invoke';

type ClaudeFilesSlice = Pick<
  DesktopAPI,
  | 'listShellSnapshots'
  | 'readShellSnapshot'
  | 'readUsageStats'
  | 'listTelemetryEvents'
  | 'readTelemetryEvent'
  | 'listFileHistory'
  | 'readCheckpoint'
  | 'readHistoryPage'
>;

export const claudeFilesCommands: ClaudeFilesSlice = {
  listShellSnapshots: () => call<FileMeta[]>('list_shell_snapshots'),
  readShellSnapshot: (name) => call<string>('read_shell_snapshot', { name }),
  readUsageStats: () => call<unknown>('read_usage_stats'),
  listTelemetryEvents: () => call<FileMeta[]>('list_telemetry_events'),
  readTelemetryEvent: (name) => call<unknown>('read_telemetry_event', { name }),
  listFileHistory: () => call<CheckpointGroup[]>('list_file_history'),
  readCheckpoint: (sessionUuid, fileHash, version) =>
    call<string>('read_checkpoint', { sessionUuid, fileHash, version }),
  readHistoryPage: (before, limit, query) =>
    call<HistoryPage>('read_history_page', { before, limit, query }),
};
