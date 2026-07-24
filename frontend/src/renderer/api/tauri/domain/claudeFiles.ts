import type {
  CheckpointGroup,
  DesktopAPI,
  FileMeta,
  HistoryPage,
  MarketplaceCatalog,
  TaskGraphMeta,
  TaskNode,
  TranscriptRecord,
} from '@shared/types/api';

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
  | 'listTranscripts'
  | 'readTranscript'
  | 'readMarketplaceCatalog'
  | 'listTaskGraphs'
  | 'readTaskGraph'
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
  listTranscripts: () => call<FileMeta[]>('list_transcripts'),
  readTranscript: (id) => call<TranscriptRecord[]>('read_transcript', { id }),
  readMarketplaceCatalog: () => call<MarketplaceCatalog>('read_marketplace_catalog'),
  listTaskGraphs: () => call<TaskGraphMeta[]>('list_task_graphs'),
  readTaskGraph: (uuid) => call<TaskNode[]>('read_task_graph', { uuid }),
};
