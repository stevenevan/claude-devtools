import { JSX, useEffect, useMemo, useState } from 'react';
import { api } from '@renderer/api';
import { CodeBlockViewer } from '@renderer/components/chat/viewers';
import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import { formatBytes } from '@renderer/utils/formatters';
import { RefreshCw } from 'lucide-react';

import type { CheckpointGroup } from '@shared/types/api';

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface SessionGroup {
  sessionUuid: string;
  files: CheckpointGroup[];
}

// Read-only 3-level drill-down over ~/.claude/file-history checkpoints:
// session -> file -> version. Each level renders only when its parent is
// selected; this panel writes nothing.
export const FileHistoryBrowserPanel = (): JSX.Element => {
  const [groups, setGroups] = useState<CheckpointGroup[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<CheckpointGroup | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);

  const sessionGroups = useMemo<SessionGroup[]>(() => {
    const bySession = new Map<string, CheckpointGroup[]>();
    for (const group of groups) {
      const files = bySession.get(group.sessionUuid);
      if (files) {
        files.push(group);
      } else {
        bySession.set(group.sessionUuid, [group]);
      }
    }
    return Array.from(bySession, ([sessionUuid, files]) => ({ sessionUuid, files }));
  }, [groups]);

  const loadList = async (): Promise<void> => {
    setListLoading(true);
    setListError(null);
    try {
      setGroups(await api.listFileHistory());
    } catch (err) {
      setListError(errText(err));
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    void loadList();
  }, []);

  const selectSession = (sessionUuid: string): void => {
    setSelectedSession(sessionUuid);
    setSelectedFile(null);
    setSelectedVersion(null);
    setContent(null);
    setContentError(null);
  };

  const selectFile = (group: CheckpointGroup): void => {
    setSelectedFile(group);
    setSelectedVersion(null);
    setContent(null);
    setContentError(null);
  };

  const selectVersion = async (version: number): Promise<void> => {
    if (!selectedSession || !selectedFile) return;
    setSelectedVersion(version);
    setContent(null);
    setContentError(null);
    setContentLoading(true);
    try {
      setContent(await api.readCheckpoint(selectedSession, selectedFile.fileHash, version));
    } catch (err) {
      setContentError(errText(err));
    } finally {
      setContentLoading(false);
    }
  };

  const activeSession = sessionGroups.find((s) => s.sessionUuid === selectedSession) ?? null;

  return (
    <div className="flex flex-col">
      <div className="border-border/50 flex items-start justify-between gap-2 border-b px-4 py-3">
        <div>
          <p className="text-foreground text-sm font-medium">File History</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Read-only browser for the per-file checkpoints Claude Code keeps under
            ~/.claude/file-history, keyed by session and an opaque file hash. Nothing here writes.
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

      {!listLoading && !listError && groups.length === 0 && (
        <p className="text-muted-foreground px-4 py-3 text-xs">
          No file-history checkpoints found under ~/.claude/file-history.
        </p>
      )}

      {!listLoading && groups.length > 0 && (
        <div className="flex flex-col gap-4 px-4 py-3">
          <div className="flex gap-4">
            <div className="flex w-56 shrink-0 flex-col gap-1.5">
              <p className="text-muted-foreground text-xs font-medium">Sessions</p>
              <div className="flex max-h-96 flex-col gap-1.5 overflow-y-auto">
                {sessionGroups.map((session) => (
                  <SessionRow
                    key={session.sessionUuid}
                    session={session}
                    selected={session.sessionUuid === selectedSession}
                    onSelect={() => selectSession(session.sessionUuid)}
                  />
                ))}
              </div>
            </div>

            {activeSession && (
              <div className="flex w-56 shrink-0 flex-col gap-1.5">
                <p className="text-muted-foreground text-xs font-medium">Files</p>
                <div className="flex max-h-96 flex-col gap-1.5 overflow-y-auto">
                  {activeSession.files.map((file) => (
                    <FileRow
                      key={file.fileHash}
                      file={file}
                      selected={file.fileHash === selectedFile?.fileHash}
                      onSelect={() => selectFile(file)}
                    />
                  ))}
                </div>
              </div>
            )}

            {selectedFile && (
              <div className="flex w-56 shrink-0 flex-col gap-1.5">
                <p className="text-muted-foreground text-xs font-medium">Versions</p>
                <div className="flex max-h-96 flex-col gap-1.5 overflow-y-auto">
                  {selectedFile.versions.map((version) => (
                    <VersionRow
                      key={version}
                      version={version}
                      selected={version === selectedVersion}
                      onSelect={() => void selectVersion(version)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="min-w-0">
            <CheckpointContent
              fileHash={selectedFile?.fileHash ?? null}
              version={selectedVersion}
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

interface SessionRowProps {
  session: SessionGroup;
  selected: boolean;
  onSelect: () => void;
}

const SessionRow = ({ session, selected, onSelect }: Readonly<SessionRowProps>): JSX.Element => (
  <Button
    variant="ghost"
    onClick={onSelect}
    className={cn(
      'h-auto w-full min-w-0 flex-col items-start gap-0.5 rounded-md border px-2.5 py-2 text-left',
      selected ? 'bg-card/50 border-border' : 'border-border/50 hover:bg-card/30'
    )}
  >
    <span className="text-foreground w-full truncate font-mono text-xs">{session.sessionUuid}</span>
    <span className="text-muted-foreground text-[10px]">{session.files.length} files</span>
  </Button>
);

interface FileRowProps {
  file: CheckpointGroup;
  selected: boolean;
  onSelect: () => void;
}

const FileRow = ({ file, selected, onSelect }: Readonly<FileRowProps>): JSX.Element => (
  <Button
    variant="ghost"
    onClick={onSelect}
    className={cn(
      'h-auto w-full min-w-0 flex-col items-start gap-0.5 rounded-md border px-2.5 py-2 text-left',
      selected ? 'bg-card/50 border-border' : 'border-border/50 hover:bg-card/30'
    )}
  >
    <span className="text-foreground w-full truncate font-mono text-xs">{file.fileHash}</span>
    <span className="text-muted-foreground text-[10px]">
      {file.versions.length} versions · {formatBytes(file.latestSize)}
    </span>
    <span className="text-muted-foreground text-[10px]">
      {new Date(file.latestMtime).toLocaleString()}
    </span>
  </Button>
);

interface VersionRowProps {
  version: number;
  selected: boolean;
  onSelect: () => void;
}

const VersionRow = ({ version, selected, onSelect }: Readonly<VersionRowProps>): JSX.Element => (
  <Button
    variant="ghost"
    onClick={onSelect}
    className={cn(
      'h-auto w-full min-w-0 items-start rounded-md border px-2.5 py-2 text-left',
      selected ? 'bg-card/50 border-border' : 'border-border/50 hover:bg-card/30'
    )}
  >
    <span className="text-foreground font-mono text-xs">v{version}</span>
  </Button>
);

interface CheckpointContentProps {
  fileHash: string | null;
  version: number | null;
  content: string | null;
  loading: boolean;
  error: string | null;
}

const CheckpointContent = ({
  fileHash,
  version,
  content,
  loading,
  error,
}: Readonly<CheckpointContentProps>): JSX.Element => {
  const placeholder = (
    <p className="text-muted-foreground text-xs">
      Select a session, file, and version to view a checkpoint.
    </p>
  );

  if (!fileHash || version === null) return placeholder;
  if (loading) return <p className="text-muted-foreground text-xs">Loading…</p>;
  if (error) {
    return (
      <div className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-xs">{error}</div>
    );
  }
  if (content === null) return placeholder;

  return <CodeBlockViewer fileName={`${fileHash}@v${version}`} content={content} />;
};
