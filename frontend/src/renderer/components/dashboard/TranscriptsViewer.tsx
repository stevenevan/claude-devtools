import { JSX, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@renderer/api';
import { CodeBlockViewer } from '@renderer/components/chat/viewers';
import { EmptyState } from '@renderer/components/common/EmptyState';
import { ErrorState } from '@renderer/components/common/ErrorState';
import { LoadingState } from '@renderer/components/common/LoadingState';
import {
  VIRTUAL_LIST_OVERSCAN,
  VirtualList,
} from '@renderer/components/common/VirtualList';
import { Button } from '@renderer/components/ui/button';
import { useUIMode } from '@renderer/hooks/useUIMode';
import { useStore } from '@renderer/store';
import { InspectorSourceSelector } from './InspectorSourceSelector';
import { InspectorEventCard } from './InspectorEventList';
import { buildSimpleTranscript } from './transcriptSimpleSteps';
import { cn } from '@renderer/lib/utils';
import { formatBytes } from '@renderer/utils/formatters';
import { RefreshCw, ScrollText } from 'lucide-react';

import type {
  InspectorEvent,
  InspectorPage,
  InspectorTranscriptMeta,
  TranscriptRecord,
} from '@shared/types/api';

const ROW_HEIGHT = 52;
const OVERSCAN = VIRTUAL_LIST_OVERSCAN;
const TRANSCRIPT_LIST_THRESHOLD = 100;

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Read-only view of ~/.claude/transcripts/ses_*.jsonl subagent transcripts.
// Master-detail: pick a transcript on the left (shared VirtualList), its
// flat 3-type record log renders on the right. Simple mode reuses the sprint
// 05 thread rules verbatim (narrative user text plus one step list, no paths
// or raw tool JSON); Nerd mode keeps the full per-kind cards. Any intentional
// divergence from the session view is noted here: transcript records are flat
// (no grouping engine), so tool_use/tool_result pairs merge by adjacency
// instead of by display item. This panel writes nothing.
export const TranscriptsViewer = (): JSX.Element => {
  const mode = useUIMode();
  const simple = mode === 'simple';
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

  const detailScrollRef = useRef<HTMLDivElement>(null);
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
      const page = cached ?? (await api.listSourceTranscripts(source, cursor, 100));
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
      const cacheKey = getInspectorCacheKey(source, 'transcript', name, null, '200');
      const cached = getInspectorCache<InspectorPage<InspectorEvent>>(cacheKey);
      const page = cached ?? (await api.readSourceTranscript(source, name, null, 200));
      if (!isCurrent()) return;
      if (!cached) setInspectorCache(cacheKey, page);
      setRecords(page.items);
      setRecordsNextCursor(page.nextCursor);
      setRecordsHasMore(page.hasMore);
      setRecordsDiagnostics(page.diagnostics.map((diagnostic) => diagnostic.message));
      setRecordsScanLimited(page.scanLimited);
    } catch (err) {
      if (isCurrent()) setRecordsError(errText(err));
    } finally {
      if (isCurrent()) setRecordsLoading(false);
    }
  };

  const loadMoreRecords = async (): Promise<void> => {
    if (!selectedName || !recordsNextCursor || !recordsHasMore) {
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
        <div className="border-border/50 flex w-72 shrink-0 flex-col overflow-hidden border-r">
          {listLoading ? (
            <LoadingState label="Loading transcripts" rows={6} />
          ) : transcripts.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title={
                simple
                  ? 'Nothing here yet'
                  : `No ${inspectorSource === 'codex' ? 'Codex' : 'Claude'} transcripts found`
              }
              hint={
                simple
                  ? 'Helper transcripts appear here once a helper runs.'
                  : 'Subagent transcripts appear here once a helper runs.'
              }
              detail={
                simple
                  ? undefined
                  : `Looked under ~/${inspectorSource === 'codex' ? '.codex/sessions' : '.claude/transcripts'}.`
              }
            />
          ) : (
            <VirtualList
              items={transcripts}
              getItemKey={(transcript) => transcript.id}
              estimateSize={() => ROW_HEIGHT}
              renderItem={(transcript) => (
                <TranscriptRow
                  transcript={transcript}
                  selected={transcript.id === selectedName}
                  onSelect={() => void selectTranscript(transcript.id)}
                />
              )}
              ariaLabel="Transcripts"
              overscan={OVERSCAN}
              threshold={TRANSCRIPT_LIST_THRESHOLD}
              scrollKey="transcript-list"
              className="w-72 shrink-0 border-r-0"
              endSentinel={
                <>
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
                </>
              }
            />
          )}
        </div>

        <div ref={detailScrollRef} className="min-w-0 flex-1 overflow-y-auto">
          <TranscriptDetail
            selectedName={selectedName}
            records={records}
            loading={recordsLoading}
            error={recordsError}
            hasMore={recordsHasMore}
            loadingMore={recordsLoadingMore}
            diagnostics={recordsDiagnostics}
            scanLimited={recordsScanLimited}
            simple={simple}
            scrollContainerRef={detailScrollRef}
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
  simple: boolean;
  scrollContainerRef: { current: HTMLElement | null };
  onLoadMore: () => void;
}

type SimpleDetailItem =
  | { type: 'user'; key: string; text: string }
  | { type: 'heading'; key: string; text: string }
  | { type: 'step'; key: string; text: string };

function buildSimpleDetailItems(
  records: (InspectorEvent | TranscriptRecord)[]
): SimpleDetailItem[] {
  const { userTexts, toolSteps } = buildSimpleTranscript(records);
  const items: SimpleDetailItem[] = userTexts.map((entry) => ({
    type: 'user',
    key: entry.id,
    text: entry.text,
  }));
  if (toolSteps.length > 0) {
    items.push({ type: 'heading', key: 'simple-transcript-steps-heading', text: 'What the helper did' });
    for (const entry of toolSteps) {
      items.push({ type: 'step', key: entry.id, text: entry.text });
    }
  }
  return items;
}

function transcriptRecordKey(record: InspectorEvent | TranscriptRecord, index: number): string {
  if (!isLegacyRecord(record)) {
    return `${record.provenance.sourceFile}:${record.provenance.line ?? index}:${record.kind}`;
  }
  return `${record.kind}:${record.timestamp ?? ''}:${index}`;
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
  simple,
  scrollContainerRef,
  onLoadMore,
}: Readonly<TranscriptDetailProps>): JSX.Element => {
  const simpleItems = useMemo(
    () => (simple && records ? buildSimpleDetailItems(records) : []),
    [simple, records]
  );

  if (!selectedName) {
    return <EmptyState icon={ScrollText} title="Select a transcript to view its records." />;
  }
  if (loading) {
    return <LoadingState label="Loading transcript" rows={6} />;
  }
  if (error) {
    return <ErrorState message="Could not load this transcript." detail={error} />;
  }
  if (!records || records.length === 0) {
    return <EmptyState icon={ScrollText} title="No records in this transcript." />;
  }

  const notices = (
    <>
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
    </>
  );

  if (simple) {
    return (
      <div className="flex flex-col gap-3 p-4">
        {notices}
        <VirtualList
          items={simpleItems}
          getItemKey={(item) => item.key}
          estimateSize={(item) => (item.type === 'heading' ? 32 : item.type === 'user' ? 72 : 36)}
          renderItem={(item) => {
            if (item.type === 'heading') {
              return (
                <h2 className="text-muted-foreground pt-2 text-[11px] font-semibold tracking-wide">
                  {item.text}
                </h2>
              );
            }
            if (item.type === 'user') {
              return (
                <p className="text-foreground text-sm whitespace-pre-wrap break-words">{item.text}</p>
              );
            }
            return <p className="text-text-secondary text-sm">· {item.text}</p>;
          }}
          ariaLabel="Transcript narrative"
          threshold={50}
          scrollKey="transcript-narrative"
          scrollContainerRef={scrollContainerRef}
        />
        {hasMore ? (
          <Button variant="outline" size="sm" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? 'Loading…' : 'Load more events'}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {notices}
      <VirtualList
        items={records}
        getItemKey={transcriptRecordKey}
        estimateSize={() => 150}
        renderItem={(record) =>
          isLegacyRecord(record) ? (
            <LegacyTranscriptRecordCard record={record} />
          ) : (
            <InspectorEventCard event={record} />
          )
        }
        ariaLabel="Transcript records"
        threshold={50}
        scrollKey="transcript-records"
        scrollContainerRef={scrollContainerRef}
        rowClassName="pb-3"
      />
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
