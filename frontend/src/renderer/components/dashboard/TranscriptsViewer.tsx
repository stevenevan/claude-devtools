import { JSX, useEffect, useRef, useState } from 'react';
import { api } from '@renderer/api';
import { CodeBlockViewer } from '@renderer/components/chat/viewers';
import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import { formatBytes } from '@renderer/utils/formatters';
import { useVirtualizer } from '@tanstack/react-virtual';
import { RefreshCw, ScrollText } from 'lucide-react';

import type { FileMeta, TranscriptRecord } from '@shared/types/api';

const ROW_HEIGHT = 52;
const OVERSCAN = 8;

const estimateRowSize = (): number => ROW_HEIGHT;

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Read-only view of ~/.claude/transcripts/ses_*.jsonl subagent transcripts.
// Master-detail: pick a transcript on the left (virtualized, ~2200 rows),
// its flat 3-type record log renders on the right via a dedicated per-kind
// renderer (no chat pipeline / DisplayItemList). This panel writes nothing.
export const TranscriptsViewer = (): JSX.Element => {
  const [transcripts, setTranscripts] = useState<FileMeta[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [records, setRecords] = useState<TranscriptRecord[] | null>(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState<string | null>(null);

  const parentRef = useRef<HTMLDivElement>(null);

  const loadList = async (): Promise<void> => {
    setListLoading(true);
    setListError(null);
    try {
      setTranscripts(await api.listTranscripts());
    } catch (err) {
      setListError(errText(err));
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    void loadList();
  }, []);

  const selectTranscript = async (name: string): Promise<void> => {
    setSelectedName(name);
    setRecords(null);
    setRecordsError(null);
    setRecordsLoading(true);
    try {
      setRecords(await api.readTranscript(name));
    } catch (err) {
      setRecordsError(errText(err));
    } finally {
      setRecordsLoading(false);
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
            Read-only view of subagent transcripts captured under ~/.claude/transcripts. Nothing
            here writes.
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={listLoading} onClick={() => void loadList()}>
          <RefreshCw className={cn('size-3.5', listLoading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {listError && (
        <div className="border-border/50 bg-destructive/10 text-destructive shrink-0 border-b px-4 py-2 text-xs">
          {listError}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div ref={parentRef} className="border-border/50 w-72 shrink-0 overflow-y-auto border-r">
          {listLoading ? (
            <p className="text-muted-foreground px-4 py-3 text-xs">Loading…</p>
          ) : transcripts.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <ScrollText className="text-muted-foreground size-6 opacity-50" />
              <p className="text-muted-foreground text-xs">
                No transcripts found under ~/.claude/transcripts.
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
                      selected={transcript.name === selectedName}
                      onSelect={() => void selectTranscript(transcript.name)}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto">
          <TranscriptDetail
            selectedName={selectedName}
            records={records}
            loading={recordsLoading}
            error={recordsError}
          />
        </div>
      </div>
    </div>
  );
};

interface TranscriptRowProps {
  transcript: FileMeta;
  selected: boolean;
  onSelect: () => void;
}

const TranscriptRow = ({ transcript, selected, onSelect }: Readonly<TranscriptRowProps>): JSX.Element => (
  <Button
    variant="ghost"
    onClick={onSelect}
    className={cn(
      'h-auto w-full min-w-0 flex-col items-start gap-0.5 rounded-none border-b px-4 py-2 text-left',
      selected ? 'bg-card/60' : 'hover:bg-card/30'
    )}
  >
    <span className="text-foreground w-full truncate font-mono text-xs">{transcript.name}</span>
    <span className="text-muted-foreground text-[10px]">
      {formatBytes(transcript.sizeBytes)} · {new Date(transcript.mtime).toLocaleString()}
    </span>
  </Button>
);

interface TranscriptDetailProps {
  selectedName: string | null;
  records: TranscriptRecord[] | null;
  loading: boolean;
  error: string | null;
}

const TranscriptDetail = ({
  selectedName,
  records,
  loading,
  error,
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
    return <p className="text-muted-foreground px-4 py-3 text-xs">Loading…</p>;
  }
  if (error) {
    return (
      <div className="bg-destructive/10 text-destructive m-4 rounded-md px-3 py-2 text-xs">
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
      {records.map((record, index) => (
        <TranscriptRecordCard key={index} record={record} />
      ))}
    </div>
  );
};

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

const TranscriptRecordCard = ({ record }: Readonly<{ record: TranscriptRecord }>): JSX.Element => {
  const timestamp = record.timestamp ? new Date(record.timestamp).toLocaleString() : null;

  if (record.kind === 'user') {
    return (
      <div className="border-border bg-card/40 rounded-md border p-3">
        <RecordHeader label="User" timestamp={timestamp} truncated={record.truncated} />
        {/* Untrusted pasted text: plain JSX interpolation escapes it. Never
            dangerouslySetInnerHTML / rehype-raw here — a Tauri-webview XSS
            escalates to the Rust FS commands. */}
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
          <CodeBlockViewer
            fileName={record.toolName ?? 'output'}
            content={record.toolOutput ?? ''}
          />
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
