import { JSX, useEffect, useRef, useState } from 'react';
import { api } from '@renderer/api';
import { CodeBlockViewer } from '@renderer/components/chat/viewers';
import { Button } from '@renderer/components/ui/button';
import { useStore } from '@renderer/store';
import { InspectorSourceSelector } from './InspectorSourceSelector';
import { InspectorEventCard } from './InspectorEventList';
import { cn } from '@renderer/lib/utils';
import { formatBytes } from '@renderer/utils/formatters';
import { useVirtualizer } from '@tanstack/react-virtual';
import { RefreshCw, ScrollText } from 'lucide-react';

import type {
  InspectorEvent,
  InspectorPage,
  InspectorTranscriptMeta,
  FileMeta,
  TranscriptRecord,
} from '@shared/types/api';

const ROW_HEIGHT = 52;
const OVERSCAN = 8;

const estimateRowSize = (): number => ROW_HEIGHT;

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toTranscriptPage(files: FileMeta[]): InspectorPage<InspectorTranscriptMeta> {
  return {
    items: files.map((file) => ({
      id: file.name,
      label: file.name,
      sizeBytes: file.sizeBytes,
      mtime: file.mtime,
      source: 'claude',
      archived: false,
      provenance: {
        sourceFile: `transcripts/${file.name}`,
        archived: false,
      },
    })),
    nextCursor: null,
    hasMore: false,
    totalMatched: files.length,
    scanLimited: false,
    diagnostics: [],
  };
}

// Read-only view of ~/.claude/transcripts/ses_*.jsonl subagent transcripts.
// Master-detail: pick a transcript on the left (virtualized, ~2200 rows),
// its flat 3-type record log renders on the right via a dedicated per-kind
// renderer (no chat pipeline / DisplayItemList). This panel writes nothing.
export const TranscriptsViewer = (): JSX.Element => {
  const inspectorSource = useStore((state) => state.inspectorSource);
  const inspectorSourceGeneration = useStore((state) => state.inspectorSourceGeneration);
  const getInspectorCacheKey = useStore((state) => state.getInspectorCacheKey);
  const getInspectorCache = useStore((state) => state.getInspectorCache);
  const setInspectorCache = useStore((state) => state.setInspectorCache);
  const [transcripts, setTranscripts] = useState<InspectorTranscriptMeta[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listLoadingMore, setListLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [listNextCursor, setListNextCursor] = useState<string | null>(null);
  const [listHasMore, setListHasMore] = useState(false);
  const [listDiagnostics, setListDiagnostics] = useState<string[]>([]);
  const [listScanLimited, setListScanLimited] = useState(false);

  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [records, setRecords] = useState<(InspectorEvent | TranscriptRecord)[] | null>(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsLoadingMore, setRecordsLoadingMore] = useState(false);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [recordsNextCursor, setRecordsNextCursor] = useState<string | null>(null);
  const [recordsHasMore, setRecordsHasMore] = useState(false);
  const [recordsDiagnostics, setRecordsDiagnostics] = useState<string[]>([]);
  const [recordsScanLimited, setRecordsScanLimited] = useState(false);

  const parentRef = useRef<HTMLDivElement>(null);
  const requestGenerationRef = useRef(0);

  const loadList = async (cursor: string | null = null, append = false): Promise<void> => {
    const requestGeneration = ++requestGenerationRef.current;
    const source = inspectorSource;
    const sourceGeneration = inspectorSourceGeneration;
    const isCurrent = (): boolean =>
      requestGeneration === requestGenerationRef.current &&
      useStore.getState().inspectorSource === source &&
      useStore.getState().inspectorSourceGeneration === sourceGeneration;
    setListLoading(!append);
    setListLoadingMore(append);
    setListError(null);
    try {
      const cacheKey = getInspectorCacheKey(source, 'transcripts', undefined, cursor, '100');
      const cached = cursor ? getInspectorCache<InspectorPage<InspectorTranscriptMeta>>(cacheKey) : undefined;
      const page =
        cached ??
        (source === 'claude'
          ? toTranscriptPage(await api.listTranscripts())
          : await api.listSourceTranscripts(source, cursor, 100));
      if (!isCurrent()) return;
      if (!cached) setInspectorCache(cacheKey, page);
      setTranscripts((current) => {
        if (!append) return page.items;
        const existing = new Set(current.map((transcript) => transcript.id));
        return [...current, ...page.items.filter((transcript) => !existing.has(transcript.id))];
      });
      setListNextCursor(page.nextCursor);
      setListHasMore(page.hasMore);
      setListDiagnostics(page.diagnostics.map((diagnostic) => diagnostic.message));
      setListScanLimited(page.scanLimited);
    } catch (err) {
      if (isCurrent()) setListError(errText(err));
    } finally {
      if (isCurrent()) {
        setListLoading(false);
        setListLoadingMore(false);
      }
    }
  };

  useEffect(() => {
    void loadList();
    setSelectedName(null);
    setRecords(null);
    setListNextCursor(null);
    setListHasMore(false);
    setListDiagnostics([]);
    setListScanLimited(false);
    setRecordsNextCursor(null);
    setRecordsHasMore(false);
    setRecordsDiagnostics([]);
    setRecordsScanLimited(false);
  }, [inspectorSource, inspectorSourceGeneration]);

  const selectTranscript = async (name: string): Promise<void> => {
    const requestGeneration = ++requestGenerationRef.current;
    const source = inspectorSource;
    const sourceGeneration = inspectorSourceGeneration;
    const isCurrent = (): boolean =>
      requestGeneration === requestGenerationRef.current &&
      useStore.getState().inspectorSource === source &&
      useStore.getState().inspectorSourceGeneration === sourceGeneration;
    setSelectedName(name);
    setRecords(null);
    setRecordsError(null);
    setRecordsNextCursor(null);
    setRecordsHasMore(false);
    setRecordsDiagnostics([]);
    setRecordsScanLimited(false);
    setRecordsLoading(true);
    try {
      if (source === 'claude') {
        const legacyRecords = await api.readTranscript(name);
        if (!isCurrent()) return;
        setRecords(legacyRecords);
      } else {
        const cacheKey = getInspectorCacheKey(source, 'transcript', name, null, '200');
        const page = await api.readSourceTranscript(source, name, null, 200);
        if (!isCurrent()) return;
        setInspectorCache(cacheKey, page);
        setRecords(page.items);
        setRecordsNextCursor(page.nextCursor);
        setRecordsHasMore(page.hasMore);
        setRecordsDiagnostics(page.diagnostics.map((diagnostic) => diagnostic.message));
        setRecordsScanLimited(page.scanLimited);
      }
    } catch (err) {
      if (isCurrent()) setRecordsError(errText(err));
    } finally {
      if (isCurrent()) setRecordsLoading(false);
    }
  };

  const loadMoreRecords = async (): Promise<void> => {
    if (inspectorSource !== 'codex' || !selectedName || !recordsNextCursor || !recordsHasMore) {
      return;
    }
    const requestGeneration = ++requestGenerationRef.current;
    const source = inspectorSource;
    const sourceGeneration = inspectorSourceGeneration;
    const cursor = recordsNextCursor;
    const isCurrent = (): boolean =>
      requestGeneration === requestGenerationRef.current &&
      useStore.getState().inspectorSource === source &&
      useStore.getState().inspectorSourceGeneration === sourceGeneration;
    const cacheKey = getInspectorCacheKey(source, 'transcript', selectedName, cursor, '200');
    setRecordsLoadingMore(true);
    try {
      const cached = getInspectorCache<InspectorPage<InspectorEvent>>(cacheKey);
      const page = cached ?? (await api.readSourceTranscript(source, selectedName, cursor, 200));
      if (!isCurrent()) return;
      if (!cached) setInspectorCache(cacheKey, page);
      setRecords((current) => {
        const existing = new Set(
          (current ?? []).map((record) =>
            'provenance' in record
              ? `${record.provenance.sourceFile}:${record.provenance.line ?? ''}:${record.kind}`
              : `${record.kind}:${record.timestamp ?? ''}`
          )
        );
        return [
          ...(current ?? []),
          ...page.items.filter((event) => {
            const key = `${event.provenance.sourceFile}:${event.provenance.line ?? ''}:${event.kind}`;
            if (existing.has(key)) return false;
            existing.add(key);
            return true;
          }),
        ];
      });
      setRecordsNextCursor(page.nextCursor);
      setRecordsHasMore(page.hasMore);
      setRecordsDiagnostics((current) => [
        ...current,
        ...page.diagnostics
          .map((diagnostic) => diagnostic.message)
          .filter((message) => !current.includes(message)),
      ]);
      setRecordsScanLimited((current) => current || page.scanLimited);
    } catch (err) {
      if (isCurrent()) setRecordsError(errText(err));
    } finally {
      if (isCurrent()) setRecordsLoadingMore(false);
    }
  };

  const rowVirtualizer = useVirtualizer({
    count: transcripts.length,
    getScrollElement: () => parentRef.current,
    estimateSize: estimateRowSize,
    overscan: OVERSCAN,
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-border/50 flex shrink-0 items-start justify-between gap-2 border-b px-4 py-3">
        <div>
          <p className="text-foreground text-sm font-medium">Transcripts</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Read-only view of subagent transcripts captured under{' '}
            {inspectorSource === 'codex' ? '~/.codex/sessions' : '~/.claude/transcripts'}. Nothing
            here writes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <InspectorSourceSelector />
          <Button variant="outline" size="sm" disabled={listLoading} onClick={() => void loadList()}>
            <RefreshCw className={cn('size-3.5', listLoading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {listError && (
        <div
          role="alert"
          className="border-border/50 bg-destructive/10 text-destructive shrink-0 border-b px-4 py-2 text-xs"
        >
          {listError}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div
          ref={parentRef}
          aria-label="Transcripts"
          className="border-border/50 w-72 shrink-0 overflow-y-auto border-r"
        >
          {listLoading ? (
            <p role="status" className="text-muted-foreground px-4 py-3 text-xs">
              Loading…
            </p>
          ) : transcripts.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <ScrollText className="text-muted-foreground size-6 opacity-50" />
              <p className="text-muted-foreground text-xs">
                No transcripts found under{' '}
                {inspectorSource === 'codex' ? '~/.codex/sessions' : '~/.claude/transcripts'}.
              </p>
            </div>
          ) : (
            <div
              className="relative w-full"
              style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const transcript = transcripts[virtualRow.index];
                if (!transcript) return null;
                return (
                  <div
                    key={virtualRow.key}
                    className="absolute top-0 left-0 w-full"
                    style={{
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <TranscriptRow
                      transcript={transcript}
                      selected={transcript.id === selectedName}
                      onSelect={() => void selectTranscript(transcript.id)}
                    />
                  </div>
                );
              })}
            </div>
          )}
          {listDiagnostics.length > 0 ? (
            <div role="status" className="border-border m-2 rounded-md border px-2 py-1.5">
              <p className="text-amber-500 text-[10px] font-medium">Read warnings</p>
              <ul className="text-muted-foreground mt-1 list-disc pl-3 text-[10px]">
                {listDiagnostics.map((diagnostic) => <li key={diagnostic}>{diagnostic}</li>)}
              </ul>
            </div>
          ) : null}
          {listScanLimited ? (
            <p role="status" className="text-muted-foreground px-3 py-2 text-[10px]">
              Transcript discovery stopped at the read safety limit.
            </p>
          ) : null}
          {listHasMore ? (
            <Button
              variant="outline"
              size="sm"
              className="m-2"
              disabled={listLoadingMore}
              onClick={() => void loadList(listNextCursor, true)}
            >
              {listLoadingMore ? 'Loading…' : 'Load more transcripts'}
            </Button>
          ) : null}
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto">
          <TranscriptDetail
            selectedName={selectedName}
            records={records}
            loading={recordsLoading}
            error={recordsError}
            hasMore={recordsHasMore}
            loadingMore={recordsLoadingMore}
            diagnostics={recordsDiagnostics}
            scanLimited={recordsScanLimited}
            onLoadMore={() => void loadMoreRecords()}
          />
        </div>
      </div>
    </div>
  );
};

interface TranscriptRowProps {
  transcript: InspectorTranscriptMeta;
  selected: boolean;
  onSelect: () => void;
}

const TranscriptRow = ({ transcript, selected, onSelect }: Readonly<TranscriptRowProps>): JSX.Element => (
  <Button
    variant="ghost"
    aria-current={selected || undefined}
    onClick={onSelect}
    className={cn(
      'h-auto w-full min-w-0 flex-col items-start gap-0.5 rounded-none border-b px-4 py-2 text-left',
      selected ? 'bg-card/60' : 'hover:bg-card/30'
    )}
  >
    <span className="text-foreground w-full truncate font-mono text-xs">{transcript.label}</span>
    <span className="text-muted-foreground text-[10px]">
      {formatBytes(transcript.sizeBytes)} ·{' '}
      {transcript.mtime ? new Date(transcript.mtime).toLocaleString() : 'unknown time'}
      {transcript.archived ? ' · archived' : ''}
    </span>
  </Button>
);

interface TranscriptDetailProps {
  selectedName: string | null;
  records: (InspectorEvent | TranscriptRecord)[] | null;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  diagnostics: string[];
  scanLimited: boolean;
  onLoadMore: () => void;
}

const TranscriptDetail = ({
  selectedName,
  records,
  loading,
  error,
  hasMore,
  loadingMore,
  diagnostics,
  scanLimited,
  onLoadMore,
}: Readonly<TranscriptDetailProps>): JSX.Element => {
  if (!selectedName) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <ScrollText className="text-muted-foreground size-6 opacity-50" />
        <p className="text-muted-foreground text-xs">Select a transcript to view its records.</p>
      </div>
    );
  }
  if (loading) {
    return (
      <p role="status" className="text-muted-foreground px-4 py-3 text-xs">
        Loading…
      </p>
    );
  }
  if (error) {
    return (
      <div
        role="alert"
        className="bg-destructive/10 text-destructive m-4 rounded-md px-3 py-2 text-xs"
      >
        {error}
      </div>
    );
  }
  if (!records || records.length === 0) {
    return (
      <p className="text-muted-foreground px-4 py-3 text-xs">No records in this transcript.</p>
    );
  }
  return (
    <div className="flex flex-col gap-3 p-4">
      {diagnostics.length > 0 ? (
        <div role="status" className="border-border rounded-md border bg-amber-500/10 px-3 py-2">
          <p className="text-amber-500 text-[10px] font-medium">Read warnings</p>
          <ul className="text-muted-foreground mt-1 list-disc pl-4 text-[10px]">
            {diagnostics.map((diagnostic) => <li key={diagnostic}>{diagnostic}</li>)}
          </ul>
        </div>
      ) : null}
      {scanLimited ? (
        <p role="status" className="text-muted-foreground text-[10px]">
          This transcript is truncated at the read safety limit.
        </p>
      ) : null}
      {records.map((record, index) => (
        <div key={index}>
          {isLegacyRecord(record) ? (
            <LegacyTranscriptRecordCard record={record} />
          ) : (
            <InspectorEventCard event={record} />
          )}
        </div>
      ))}
      {hasMore ? (
        <Button variant="outline" size="sm" disabled={loadingMore} onClick={onLoadMore}>
          {loadingMore ? 'Loading…' : 'Load more events'}
        </Button>
      ) : null}
    </div>
  );
};

function isLegacyRecord(record: InspectorEvent | TranscriptRecord): record is TranscriptRecord {
  return 'toolInput' in record;
}

const RecordHeader = ({
  label,
  timestamp,
  truncated,
}: Readonly<{ label: string; timestamp: string | null; truncated: boolean }>): JSX.Element => (
  <div className="flex items-center justify-between gap-2">
    <div className="flex items-center gap-1.5">
      <span className="text-foreground text-xs font-medium">{label}</span>
      {truncated && (
        <span className="rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">
          truncated
        </span>
      )}
    </div>
    {timestamp && <span className="text-muted-foreground text-[10px]">{timestamp}</span>}
  </div>
);

const LegacyTranscriptRecordCard = ({
  record,
}: Readonly<{ record: TranscriptRecord }>): JSX.Element => {
  const timestamp = record.timestamp ? new Date(record.timestamp).toLocaleString() : null;

  if (record.kind === 'user') {
    return (
      <div className="border-border bg-card/40 rounded-md border p-3">
        <RecordHeader label="User" timestamp={timestamp} truncated={record.truncated} />
        <p className="text-foreground mt-1.5 text-xs whitespace-pre-wrap break-words">
          {record.content}
        </p>
      </div>
    );
  }
  if (record.kind === 'tool_use') {
    return (
      <div className="border-border bg-card/40 rounded-md border p-3">
        <RecordHeader
          label={`Tool call · ${record.toolName ?? 'unknown'}`}
          timestamp={timestamp}
          truncated={record.truncated}
        />
        <div className="mt-1.5">
          <CodeBlockViewer
            fileName={`${record.toolName ?? 'tool'}.json`}
            content={record.toolInput ?? ''}
            language="json"
          />
        </div>
      </div>
    );
  }
  if (record.kind === 'tool_result') {
    return (
      <div className="border-border bg-card/40 rounded-md border p-3">
        <RecordHeader
          label={`Tool result · ${record.toolName ?? 'unknown'}`}
          timestamp={timestamp}
          truncated={record.truncated}
        />
        <div className="mt-1.5">
          <CodeBlockViewer fileName={record.toolName ?? 'output'} content={record.toolOutput ?? ''} />
        </div>
      </div>
    );
  }
  return (
    <div className="border-border bg-card/40 rounded-md border p-3">
      <RecordHeader
        label={`Unknown · ${record.kind || '(empty)'}`}
        timestamp={timestamp}
        truncated={record.truncated}
      />
    </div>
  );
};
