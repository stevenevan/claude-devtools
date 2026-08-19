import { JSX, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@renderer/api';
import { CodeBlockViewer } from '@renderer/components/chat/viewers';
import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import { formatBytes } from '@renderer/utils/formatters';
import { AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react';

import type { ShellSnapshotDetail, ShellSnapshotItem, SourceKind } from '@shared/types/api';

interface ShellSnapshotPanelProps {
  source: SourceKind;
}

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const ShellSnapshotPanel = ({ source }: Readonly<ShellSnapshotPanelProps>): JSX.Element => {
  const [snapshots, setSnapshots] = useState<ShellSnapshotItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [detail, setDetail] = useState<ShellSnapshotDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const requestId = useRef(0);

  const loadList = useCallback(async (): Promise<void> => {
    const request = ++requestId.current;
    setListLoading(true);
    setListError(null);
    setSnapshots([]);
    setSelectedName(null);
    setDetail(null);
    setDetailError(null);
    setNextCursor(null);
    try {
      const page = await api.listSourceShellSnapshots(source, null, 50);
      if (request !== requestId.current) return;
      setSnapshots(page.items);
      setNextCursor(page.nextCursor);
      if (page.diagnostics.length > 0) setListError(page.diagnostics.map((item) => item.message).join(' '));
    } catch (error) {
      if (request !== requestId.current) return;
      setSnapshots([]);
      setListError(errText(error));
    } finally {
      if (request === requestId.current) setListLoading(false);
    }
  }, [source]);

  useEffect(() => {
    setSelectedName(null);
    setDetail(null);
    setDetailError(null);
    void loadList();
  }, [loadList]);

  const loadMore = async (): Promise<void> => {
    if (!nextCursor) return;
    const request = ++requestId.current;
    setListLoading(true);
    try {
      const page = await api.listSourceShellSnapshots(source, nextCursor, 50);
      if (request !== requestId.current) return;
      setSnapshots((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      if (request !== requestId.current) return;
      setListError(errText(error));
    } finally {
      if (request === requestId.current) setListLoading(false);
    }
  };

  const selectSnapshot = async (name: string): Promise<void> => {
    const request = ++requestId.current;
    setSelectedName(name);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const result = await api.readSourceShellSnapshot(source, name);
      if (request !== requestId.current) return;
      setDetail(result);
    } catch (error) {
      if (request !== requestId.current) return;
      setDetailError(errText(error));
    } finally {
      if (request === requestId.current) setDetailLoading(false);
    }
  };

  const root = source === 'codex' ? '~/.codex/shell_snapshots' : '~/.claude/shell-snapshots';

  return (
    <div className="flex flex-col">
      <div className="border-border/50 flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-muted-foreground size-4" aria-hidden="true" />
            <p className="text-foreground text-sm font-medium">Shell snapshots</p>
          </div>
          <p className="text-muted-foreground mt-1 max-w-2xl text-xs">
            Safe previews from {root}. Known environment assignments are redacted and unsupported
            formats stay unavailable. Nothing is executed.
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={listLoading} onClick={() => void loadList()}>
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>

      {listError && <ErrorMessage message={listError} />}
      {listLoading && snapshots.length === 0 && (
        <p role="status" className="text-muted-foreground px-4 py-3 text-xs">
          Loading snapshots…
        </p>
      )}
      {!listLoading && !listError && snapshots.length === 0 && (
        <p className="text-muted-foreground px-4 py-3 text-xs">No shell snapshots were found.</p>
      )}

      {snapshots.length > 0 && (
        <div className="flex flex-col gap-3 px-4 py-4 lg:flex-row">
          <div aria-label="Shell snapshots" className="flex max-h-96 min-w-0 flex-col gap-1.5 lg:w-72">
            {snapshots.map((snapshot) => (
              <Button
                key={snapshot.name}
                variant="ghost"
                aria-current={snapshot.name === selectedName || undefined}
                onClick={() => void selectSnapshot(snapshot.name)}
                className={cn(
                  'h-auto w-full min-w-0 flex-col items-start gap-0.5 rounded-md border px-2.5 py-2 text-left',
                  snapshot.name === selectedName
                    ? 'bg-card/50 border-border'
                    : 'border-border/50 hover:bg-card/30'
                )}
              >
                <span className="text-foreground w-full truncate font-mono text-xs">{snapshot.name}</span>
                <span className="text-muted-foreground text-[10px]">
                  {formatBytes(snapshot.sizeBytes)} · {new Date(snapshot.mtime).toLocaleString()}
                </span>
              </Button>
            ))}
            {nextCursor && (
              <Button variant="outline" size="sm" disabled={listLoading} onClick={() => void loadMore()}>
                Load more
              </Button>
            )}
          </div>
          <SnapshotContent
            selectedName={selectedName}
            detail={detail}
            loading={detailLoading}
            error={detailError}
          />
        </div>
      )}
    </div>
  );
};

const SnapshotContent = ({
  selectedName,
  detail,
  loading,
  error,
}: Readonly<{
  selectedName: string | null;
  detail: ShellSnapshotDetail | null;
  loading: boolean;
  error: string | null;
}>): JSX.Element => {
  if (!selectedName) {
    return <p className="text-muted-foreground min-w-0 flex-1 text-xs">Select a snapshot to inspect it.</p>;
  }
  if (loading) {
    return (
      <p role="status" className="text-muted-foreground min-w-0 flex-1 text-xs">
        Loading snapshot…
      </p>
    );
  }
  if (error) return <ErrorMessage message={error} />;
  if (!detail) return <p className="text-muted-foreground text-xs">Snapshot details are unavailable.</p>;
  if (!detail.content) {
    return (
      <div className="border-border/50 min-w-0 flex-1 rounded-md border p-3">
        <div className="flex items-start gap-2 text-xs">
          <AlertTriangle className="text-warning mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span className="text-muted-foreground">
            {detail.unavailableReason ?? 'Snapshot content is unavailable for safe display.'}
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="min-w-0 flex-1">
      <div className="text-muted-foreground mb-2 flex flex-wrap gap-2 text-[11px]">
        <span>{detail.item.redaction}</span>
        {detail.truncated && <span>Preview truncated at the reader limit.</span>}
      </div>
      <CodeBlockViewer fileName={detail.item.name} content={detail.content} language="bash" />
    </div>
  );
};

const ErrorMessage = ({ message }: Readonly<{ message: string }>): JSX.Element => (
  <div role="alert" className="bg-destructive/10 text-destructive border-border/50 border-b px-4 py-2 text-xs">
    {message}
  </div>
);
