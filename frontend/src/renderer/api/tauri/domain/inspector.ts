import type {
  DesktopAPI,
  InspectorEvent,
  InspectorHistoryEntry,
  InspectorPage,
  InspectorSourceStatus,
  InspectorTaskGraphList,
  InspectorTaskGraphResult,
  InspectorTranscriptMeta,
  SourceKind,
} from '@shared/types/api';

import { call } from '../invoke';

type InspectorCommands = Pick<
  DesktopAPI,
  | 'getInspectorSources'
  | 'readSourceHistoryPage'
  | 'listSourceTranscripts'
  | 'readSourceTranscript'
  | 'readSourceSession'
  | 'listSourceTaskGraphs'
  | 'readSourceTaskGraph'
>;

export const inspectorCommands: InspectorCommands = {
  getInspectorSources: () => call<InspectorSourceStatus[]>('get_inspector_sources'),
  readSourceHistoryPage: (sourceKind, cursor, limit, query) =>
    call<InspectorPage<InspectorHistoryEntry>>('read_source_history_page', {
      sourceKind,
      cursor,
      limit,
      query,
    }),
  listSourceTranscripts: (sourceKind, cursor, limit) =>
    call<InspectorPage<InspectorTranscriptMeta>>('list_source_transcripts', {
      sourceKind,
      cursor,
      limit,
    }),
  readSourceTranscript: (sourceKind, id, cursor, limit) =>
    call<InspectorPage<InspectorEvent>>('read_source_transcript', {
      sourceKind,
      id,
      cursor,
      limit,
    }),
  readSourceSession: (sourceKind, id, cursor, limit) =>
    call<InspectorPage<InspectorEvent>>('read_source_session', {
      sourceKind,
      id,
      cursor,
      limit,
    }),
  listSourceTaskGraphs: (sourceKind) =>
    call<InspectorTaskGraphList>('list_source_task_graphs', { sourceKind }),
  readSourceTaskGraph: (sourceKind, id) =>
    call<InspectorTaskGraphResult>('read_source_task_graph', { sourceKind, id }),
};
