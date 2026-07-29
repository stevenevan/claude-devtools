import { JSX, useEffect, useMemo, useState } from 'react';
import { api } from '@renderer/api';
import { CodeBlockViewer, DiffViewer } from '@renderer/components/chat/viewers';
import { CopyablePath } from '@renderer/components/common/CopyablePath';
import { CopyButton } from '@renderer/components/common/CopyButton';
import { Button } from '@renderer/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@renderer/components/ui/native-select';
import { cn } from '@renderer/lib/utils';
import { formatBytes } from '@renderer/utils/formatters';
import { RefreshCw } from 'lucide-react';

import type { CheckpointGroup, CheckpointOrigin } from '@shared/types/api';

const COMPARE_OFF = '';

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

  const [compareVersion, setCompareVersion] = useState<number | null>(null);
  const [compareContent, setCompareContent] = useState<string | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);

  // Origin is per file hash, so it survives version switching. It is
  // deliberately NOT cleared in resetCompare: selectVersion calls that, and the
  // action row only renders once a version is selected, so clearing there would
  // wipe the value selectFile just resolved and the Restore button would never
  // appear.
  const [origin, setOrigin] = useState<CheckpointOrigin | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoredPath, setRestoredPath] = useState<string | null>(null);

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

  const resetCompare = (): void => {
    setCompareVersion(null);
    setCompareContent(null);
    setCompareError(null);
    setExported(false);
    setRestoredPath(null);
  };

  const selectSession = (sessionUuid: string): void => {
    setSelectedSession(sessionUuid);
    setSelectedFile(null);
    setSelectedVersion(null);
    setContent(null);
    setContentError(null);
    setOrigin(null);
    resetCompare();
  };

  const selectFile = async (group: CheckpointGroup): Promise<void> => {
    setSelectedFile(group);
    setSelectedVersion(null);
    setContent(null);
    setContentError(null);
    setOrigin(null);
    resetCompare();
    if (!selectedSession) return;
    try {
      setOrigin(await api.resolveCheckpointOrigin(selectedSession, group.fileHash));
    } catch (err) {
      setContentError(errText(err));
    }
  };

  const selectVersion = async (version: number): Promise<void> => {
    if (!selectedSession || !selectedFile) return;
    setSelectedVersion(version);
    setContent(null);
    setContentError(null);
    resetCompare();
    setContentLoading(true);
    try {
      setContent(await api.readCheckpoint(selectedSession, selectedFile.fileHash, version));
    } catch (err) {
      setContentError(errText(err));
    } finally {
      setContentLoading(false);
    }
  };

  const selectCompareVersion = async (raw: string): Promise<void> => {
    if (!selectedSession || !selectedFile) return;
    if (raw === COMPARE_OFF) {
      resetCompare();
      return;
    }
    const version = Number(raw);
    setCompareVersion(version);
    setCompareContent(null);
    setCompareError(null);
    try {
      setCompareContent(
        await api.readCheckpoint(selectedSession, selectedFile.fileHash, version)
      );
    } catch (err) {
      setCompareError(errText(err));
    }
  };

  const exportSelected = async (): Promise<void> => {
    if (!selectedSession || !selectedFile || selectedVersion === null) return;
    setExporting(true);
    setExported(false);
    try {
      const saved = await api.exportCheckpoint(
        selectedSession,
        selectedFile.fileHash,
        selectedVersion
      );
      setExported(saved);
    } catch (err) {
      setContentError(errText(err));
    } finally {
      setExporting(false);
    }
  };

  const restoreSelected = async (): Promise<void> => {
    if (!selectedSession || !selectedFile || selectedVersion === null) return;
    setRestoring(true);
    setRestoredPath(null);
    try {
      setRestoredPath(
        await api.restoreCheckpoint(selectedSession, selectedFile.fileHash, selectedVersion)
      );
    } catch (err) {
      setContentError(errText(err));
    } finally {
      setRestoring(false);
    }
  };

  const activeSession = sessionGroups.find((s) => s.sessionUuid === selectedSession) ?? null;

  return (
    <div className="flex flex-col">
      <div className="border-border/50 flex items-start justify-between gap-2 border-b px-4 py-3">
        <div>
          <p className="text-foreground text-sm font-medium">File History</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Browser for the per-file checkpoints Claude Code keeps under ~/.claude/file-history,
            keyed by session and an opaque file hash. Read-only over ~/.claude; Save as… and
            Restore both write only to the file you pick in the dialog. Always reads and writes
            this machine, even while an SSH session is connected.
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
                      onSelect={() => void selectFile(file)}
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

          <div className="flex min-w-0 flex-col gap-2">
            {selectedFile && selectedVersion !== null && content !== null && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-muted-foreground text-xs" htmlFor="checkpoint-compare">
                  Compare with
                </label>
                <NativeSelect
                  id="checkpoint-compare"
                  size="sm"
                  value={compareVersion === null ? COMPARE_OFF : String(compareVersion)}
                  onChange={(e) => void selectCompareVersion(e.target.value)}
                >
                  <NativeSelectOption value={COMPARE_OFF}>None</NativeSelectOption>
                  {selectedFile.versions
                    .filter((v) => v !== selectedVersion)
                    .map((v) => (
                      <NativeSelectOption key={v} value={String(v)}>
                        v{v}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>

                <div className="ml-auto flex items-center gap-1.5">
                  {exported && <span className="text-muted-foreground text-xs">Saved</span>}
                  <CopyButton text={content} inline />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={exporting}
                    onClick={() => void exportSelected()}
                  >
                    Save as…
                  </Button>
                </div>
              </div>
            )}

            {selectedFile && selectedVersion !== null && content !== null && (
              <div className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-2 text-xs">
                {origin ? (
                  <>
                    <span className="shrink-0">Original</span>
                    <CopyablePath
                      displayText={origin.realPath}
                      copyText={origin.realPath}
                      className="text-foreground font-mono text-[11px]"
                    />
                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                      {restoredPath && <span>Restored to {restoredPath}</span>}
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={restoring}
                        onClick={() => void restoreSelected()}
                      >
                        Restore to original…
                      </Button>
                    </div>
                  </>
                ) : (
                  <span>
                    Original path unknown — use Save as… (the session log this is recovered from
                    may have been pruned).
                  </span>
                )}
              </div>
            )}

            {compareError && (
              <div className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-xs">
                {compareError}
              </div>
            )}

            <CheckpointContent
              fileHash={selectedFile?.fileHash ?? null}
              version={selectedVersion}
              content={content}
              loading={contentLoading}
              error={contentError}
              compareVersion={compareVersion}
              compareContent={compareContent}
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
  compareVersion: number | null;
  compareContent: string | null;
}

const CheckpointContent = ({
  fileHash,
  version,
  content,
  loading,
  error,
  compareVersion,
  compareContent,
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

  // fileHash is opaque, so this header is an identifier, not a filename — no
  // language is inferred from it either way.
  if (compareVersion !== null && compareContent !== null) {
    return (
      <DiffViewer
        fileName={`${fileHash}@v${version}`}
        oldString={compareContent}
        newString={content}
      />
    );
  }

  return <CodeBlockViewer fileName={`${fileHash}@v${version}`} content={content} />;
};
