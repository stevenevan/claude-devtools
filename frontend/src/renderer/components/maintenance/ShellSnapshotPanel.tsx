import { JSX, useEffect, useState } from 'react';
import { api } from '@renderer/api';
import { CodeBlockViewer } from '@renderer/components/chat/viewers';
import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import { formatBytes } from '@renderer/utils/formatters';
import { RefreshCw } from 'lucide-react';

import type { FileMeta } from '@shared/types/api';

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Read-only view of ~/.claude/shell-snapshots. Master-detail: pick a snapshot
// on the left, its raw contents load on the right. This panel writes nothing.
export const ShellSnapshotPanel = (): JSX.Element => {
  const [snapshots, setSnapshots] = useState<FileMeta[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);

  const loadList = async (): Promise<void> => {
    setListLoading(true);
    setListError(null);
    try {
      setSnapshots(await api.listShellSnapshots());
    } catch (err) {
      setListError(errText(err));
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    void loadList();
  }, []);

  const selectSnapshot = async (name: string): Promise<void> => {
    setSelectedName(name);
    setContent(null);
    setContentError(null);
    setContentLoading(true);
    try {
      setContent(await api.readShellSnapshot(name));
    } catch (err) {
      setContentError(errText(err));
    } finally {
      setContentLoading(false);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="border-border/50 flex items-start justify-between gap-2 border-b px-4 py-3">
        <div>
          <p className="text-foreground text-sm font-medium">Shell Snapshots</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Read-only view of the shell environment snapshots Claude Code captures under
            ~/.claude/shell-snapshots. Nothing here writes.
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={listLoading} onClick={() => void loadList()}>
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>

      {listError && (
        <div className="border-border/50 bg-destructive/10 text-destructive border-b px-4 py-2 text-xs">
          {listError}
        </div>
      )}

      {listLoading && <p className="text-muted-foreground px-4 py-3 text-xs">Loading…</p>}

      {!listLoading && !listError && snapshots.length === 0 && (
        <p className="text-muted-foreground px-4 py-3 text-xs">
          No shell snapshots found under ~/.claude/shell-snapshots.
        </p>
      )}

      {!listLoading && snapshots.length > 0 && (
        <div className="flex gap-4 px-4 py-3">
          <div className="flex max-h-96 w-64 shrink-0 flex-col gap-1.5 overflow-y-auto">
            {snapshots.map((snapshot) => (
              <SnapshotRow
                key={snapshot.name}
                snapshot={snapshot}
                selected={snapshot.name === selectedName}
                onSelect={() => void selectSnapshot(snapshot.name)}
              />
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <SnapshotContent
              selectedName={selectedName}
              content={content}
              loading={contentLoading}
              error={contentError}
            />
          </div>
        </div>
      )}
    </div>
  );
};

interface SnapshotRowProps {
  snapshot: FileMeta;
  selected: boolean;
  onSelect: () => void;
}

const SnapshotRow = ({ snapshot, selected, onSelect }: Readonly<SnapshotRowProps>): JSX.Element => (
  <Button
    variant="ghost"
    onClick={onSelect}
    className={cn(
      'h-auto w-full min-w-0 flex-col items-start gap-0.5 rounded-md border px-2.5 py-2 text-left',
      selected ? 'bg-card/50 border-border' : 'border-border/50 hover:bg-card/30'
    )}
  >
    <span className="text-foreground w-full truncate font-mono text-xs">{snapshot.name}</span>
    <span className="text-muted-foreground text-[10px]">
      {formatBytes(snapshot.sizeBytes)} · {new Date(snapshot.mtime).toLocaleString()}
    </span>
  </Button>
);

interface SnapshotContentProps {
  selectedName: string | null;
  content: string | null;
  loading: boolean;
  error: string | null;
}

const SnapshotContent = ({
  selectedName,
  content,
  loading,
  error,
}: Readonly<SnapshotContentProps>): JSX.Element => {
  if (!selectedName) {
    return <p className="text-muted-foreground text-xs">Select a snapshot to view its contents.</p>;
  }
  if (loading) {
    return <p className="text-muted-foreground text-xs">Loading…</p>;
  }
  if (error) {
    return (
      <div className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-xs">{error}</div>
    );
  }
  if (content === null) {
    return <p className="text-muted-foreground text-xs">Select a snapshot to view its contents.</p>;
  }
  return <CodeBlockViewer fileName={selectedName} content={content} language="bash" />;
};
