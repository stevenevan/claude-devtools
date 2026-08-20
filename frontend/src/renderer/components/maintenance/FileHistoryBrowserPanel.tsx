import { JSX, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@renderer/api';
import { CodeBlockViewer, DiffViewer } from '@renderer/components/chat/viewers';
import { CopyablePath } from '@renderer/components/common/CopyablePath';
import { CopyButton } from '@renderer/components/common/CopyButton';
import { Button } from '@renderer/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@renderer/components/ui/native-select';
import { cn } from '@renderer/lib/utils';
import { formatBytes } from '@renderer/utils/formatters';
import { createSourceRequestGate } from './sourceRequestGate';
import { RefreshCw } from 'lucide-react';

import type { RecoveryCopy, SourceCheckpointGroup, SourceKind } from '@shared/types/api';

const COMPARE_OFF = '';

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface SessionGroup {
  sessionUuid: string;
  files: SourceCheckpointGroup[];
}

// Three-level drill-down over source file-history checkpoints: session -> file
// -> version. Reads stay source-scoped; Save as… and Restore use backend-owned
// safety checks and native local dialogs.
interface FileHistoryBrowserPanelProps {
  source: SourceKind;
}

export const FileHistoryBrowserPanel = ({
  source,
}: Readonly<FileHistoryBrowserPanelProps>): JSX.Element => {
  const checkpointMutationsSupported = source === 'claude';
  const [groups, setGroups] = useState<SourceCheckpointGroup[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listRevision, setListRevision] = useState<string | null>(null);
  const [listPartial, setListPartial] = useState(false);
  const [listDiagnostic, setListDiagnostic] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<SourceCheckpointGroup | null>(null);
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
  const [origin, setOrigin] = useState<SourceCheckpointGroup['origin']>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoredPath, setRestoredPath] = useState<string | null>(null);
  const [recoveryCopies, setRecoveryCopies] = useState<RecoveryCopy[]>([]);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const requestGate = useRef(createSourceRequestGate());

  const sessionGroups = useMemo<SessionGroup[]>(() => {
    const bySession = new Map<string, SourceCheckpointGroup[]>();
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

  const loadList = async (cursor: string | null = null, append = false): Promise<void> => {
    const request = requestGate.current.begin('list');
    setListLoading(true);
    if (!append) {
      setListError(null);
      setListDiagnostic(null);
      setListPartial(false);
      setNextCursor(null);
      setListRevision(null);
    }
    try {
      const page = await api.listSourceFileHistory(source, cursor, 100);
      if (!requestGate.current.isCurrent('list', request)) return;
      setGroups((current) => (append ? [...current, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
      setListRevision(page.revision ?? null);
      setListPartial((current) => current || page.scanLimited);
      if (page.diagnostics.length > 0) {
        setListDiagnostic(page.diagnostics.map((diagnostic) => diagnostic.message).join(' '));
      }
    } catch (err) {
      if (!requestGate.current.isCurrent('list', request)) return;
      setListError(errText(err));
    } finally {
      if (requestGate.current.isCurrent('list', request)) setListLoading(false);
    }
  };

  const loadMore = async (): Promise<void> => {
    if (!nextCursor || listLoading) return;
    await loadList(nextCursor, true);
  };

  const loadRecoveryCopies = async (): Promise<void> => {
    const request = requestGate.current.begin('recovery');
    setRecoveryLoading(true);
    setRecoveryError(null);
    try {
      const copies = await api.listCheckpointRecoveryCopies(source);
      if (!requestGate.current.isCurrent('recovery', request)) return;
      setRecoveryCopies(copies);
    } catch (err) {
      if (!requestGate.current.isCurrent('recovery', request)) return;
      setRecoveryError(errText(err));
    } finally {
      if (requestGate.current.isCurrent('recovery', request)) setRecoveryLoading(false);
    }
  };

  useEffect(() => {
    requestGate.current.switchSource();
    setGroups([]);
    setNextCursor(null);
    setListRevision(null);
    setListPartial(false);
    setSelectedSession(null);
    setSelectedFile(null);
    setSelectedVersion(null);
    setContent(null);
    setContentError(null);
    setContentLoading(false);
    setOrigin(null);
    setExporting(false);
    setRestoring(false);
    resetCompare();
    setRecoveryCopies([]);
    setRecoveryLoading(false);
    void loadList();
    if (checkpointMutationsSupported) void loadRecoveryCopies();
  }, [source]);

  const resetCompare = (): void => {
    requestGate.current.begin('compare');
    setCompareVersion(null);
    setCompareContent(null);
    setCompareError(null);
    setExported(false);
    setRestoredPath(null);
  };

  const selectSession = (sessionUuid: string): void => {
    requestGate.current.begin('origin');
    requestGate.current.begin('content');
    requestGate.current.begin('mutation');
    setSelectedSession(sessionUuid);
    setSelectedFile(null);
    setSelectedVersion(null);
    setContent(null);
    setContentError(null);
    setContentLoading(false);
    setOrigin(null);
    setExporting(false);
    setRestoring(false);
    resetCompare();
  };

  const selectFile = async (group: SourceCheckpointGroup): Promise<void> => {
    requestGate.current.begin('content');
    requestGate.current.begin('mutation');
    setSelectedFile(group);
    setSelectedVersion(null);
    setContent(null);
    setContentError(null);
    setContentLoading(false);
    setOrigin(null);
    setExporting(false);
    setRestoring(false);
    resetCompare();
    if (!selectedSession) return;
    const request = requestGate.current.begin('origin');
    try {
      const origins = await api.resolveSourceCheckpointOrigins(source, selectedSession, [group.fileHash]);
      if (!requestGate.current.isCurrent('origin', request)) return;
      setOrigin(origins[group.fileHash] ?? null);
    } catch (err) {
      if (!requestGate.current.isCurrent('origin', request)) return;
      setContentError(errText(err));
    }
  };

  const selectVersion = async (version: number): Promise<void> => {
    if (!selectedSession || !selectedFile) return;
    requestGate.current.begin('mutation');
    setSelectedVersion(version);
    setContent(null);
    setContentError(null);
    setExporting(false);
    setRestoring(false);
    resetCompare();
    setContentLoading(true);
    const request = requestGate.current.begin('content');
    try {
      const detail = await api.readSourceCheckpoint(
        source,
        selectedSession,
        selectedFile.fileHash,
        version
      );
      if (!requestGate.current.isCurrent('content', request)) return;
      setContent(detail.content);
      if (detail.contentUnavailableReason) {
        setContentError(detail.contentUnavailableReason);
      } else if (detail.binary) {
        setContentError('This checkpoint is binary and cannot be shown as text.');
      }
    } catch (err) {
      if (!requestGate.current.isCurrent('content', request)) return;
      setContentError(errText(err));
    } finally {
      if (requestGate.current.isCurrent('content', request)) setContentLoading(false);
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
    const request = requestGate.current.begin('compare');
    try {
      const detail = await api.readSourceCheckpoint(
        source,
        selectedSession,
        selectedFile.fileHash,
        version
      );
      if (!requestGate.current.isCurrent('compare', request)) return;
      if (detail.contentUnavailableReason || detail.binary || detail.content === null) {
        setCompareError(
          detail.contentUnavailableReason ?? 'This checkpoint cannot be shown as text.'
        );
      } else {
        setCompareContent(detail.content);
      }
    } catch (err) {
      if (!requestGate.current.isCurrent('compare', request)) return;
      setCompareError(errText(err));
    }
  };

  const exportSelected = async (): Promise<void> => {
    if (
      !checkpointMutationsSupported ||
      !selectedSession ||
      !selectedFile ||
      selectedVersion === null
    )
      return;
    const request = requestGate.current.begin('mutation');
    setExporting(true);
    setExported(false);
    try {
      const result = await api.saveSourceCheckpointViaDialog(
        source,
        selectedSession,
        selectedFile.fileHash,
        selectedVersion
      );
      if (!requestGate.current.isCurrent('mutation', request)) return;
      setExported(result.state === 'written');
    } catch (err) {
      if (!requestGate.current.isCurrent('mutation', request)) return;
      setContentError(errText(err));
    } finally {
      if (requestGate.current.isCurrent('mutation', request)) setExporting(false);
    }
  };

  const restoreSelected = async (): Promise<void> => {
    if (
      !checkpointMutationsSupported ||
      !selectedSession ||
      !selectedFile ||
      selectedVersion === null
    )
      return;
    const request = requestGate.current.begin('mutation');
    setRestoring(true);
    setRestoredPath(null);
    try {
      const result = await api.restoreSourceCheckpoint(
        source,
        selectedSession,
        selectedFile.fileHash,
        selectedVersion
      );
      if (!requestGate.current.isCurrent('mutation', request)) return;
      if (result.state === 'written') {
        setRestoredPath(result.targetLabel);
        await loadRecoveryCopies();
      }
    } catch (err) {
      if (!requestGate.current.isCurrent('mutation', request)) return;
      setContentError(errText(err));
    } finally {
      if (requestGate.current.isCurrent('mutation', request)) setRestoring(false);
    }
  };

  const activeSession = sessionGroups.find((s) => s.sessionUuid === selectedSession) ?? null;

  return (
    <div className="flex flex-col">
      <div className="border-border/50 flex items-start justify-between gap-2 border-b px-4 py-3">
        <div>
          <p className="text-foreground text-sm font-medium">File History</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Browser for the per-file checkpoints {source === 'codex' ? 'Codex' : 'Claude Code'}
            keeps under {source === 'codex' ? '~/.codex/file-history' : '~/.claude/file-history'}.
            {checkpointMutationsSupported
              ? ' Save as… and Restore use native dialogs and act on this machine only.'
              : ' Checkpoint Save as… and Restore are unavailable until the producer and origin contracts are pinned.'}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={listLoading}
          onClick={() => void loadList()}
        >
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>

      {listError && (
        <div
          role="alert"
          className="border-border/50 bg-destructive/10 text-destructive border-b px-4 py-2 text-xs"
        >
          {listError}
        </div>
      )}

      {listDiagnostic && (
        <div
          role="status"
          className="border-border/50 bg-card/50 text-muted-foreground border-b px-4 py-2 text-xs"
        >
          {listDiagnostic}
        </div>
      )}

      {listPartial && (
        <div
          role="status"
          className="border-border/50 bg-card/50 text-muted-foreground border-b px-4 py-2 text-xs"
        >
          File History is showing a bounded partial result. Refresh after reducing the dataset if
          you need a complete scan.
        </div>
      )}

      {recoveryError && (
        <div role="alert" className="border-border/50 bg-destructive/10 text-destructive border-b px-4 py-2 text-xs">
          {recoveryError}
        </div>
      )}

      {listLoading && (
        <p role="status" className="text-muted-foreground px-4 py-3 text-xs">
          Loading…
        </p>
      )}

      {!listLoading && !listError && !listDiagnostic && !listPartial && groups.length === 0 && (
        <p className="text-muted-foreground px-4 py-3 text-xs">
          No file-history checkpoints found under {source === 'codex' ? '~/.codex/file-history' : '~/.claude/file-history'}.
        </p>
      )}

      {!listLoading && groups.length > 0 && (
        <div className="flex flex-col gap-4 px-4 py-3">
          <div className="flex gap-4">
            <div className="flex w-56 shrink-0 flex-col gap-1.5">
              <p className="text-muted-foreground text-xs font-medium">Sessions</p>
              <div aria-label="Sessions" className="flex max-h-96 flex-col gap-1.5 overflow-y-auto">
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
                <div aria-label="Files" className="flex max-h-96 flex-col gap-1.5 overflow-y-auto">
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
                <div aria-label="Versions" className="flex max-h-96 flex-col gap-1.5 overflow-y-auto">
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

          {(nextCursor || listRevision) && (
            <div className="flex items-center gap-2">
              {nextCursor && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={listLoading}
                  title={listRevision ? `Continue from revision ${listRevision}` : undefined}
                  onClick={() => void loadMore()}
                >
                  Load more
                </Button>
              )}
              {listRevision && (
                <span className="text-muted-foreground text-[10px]" aria-label="File History revision">
                  Source revision tracked
                </span>
              )}
            </div>
          )}

          <div className="flex min-w-0 flex-col gap-2">
            {selectedFile && selectedVersion !== null && (
              <div className="flex flex-wrap items-center gap-2">
                {content !== null && (
                  <>
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
                  </>
                )}

                <div className="ml-auto flex items-center gap-1.5">
                  {checkpointMutationsSupported && exported && (
                    <span className="text-muted-foreground text-xs">Saved</span>
                  )}
                  {content !== null && <CopyButton text={content} inline />}
                  {checkpointMutationsSupported ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={exporting}
                      onClick={() => void exportSelected()}
                    >
                      Save as…
                    </Button>
                  ) : (
                    <span role="status" className="text-muted-foreground text-xs">
                      Save as… and Restore are unavailable for Codex checkpoints.
                    </span>
                  )}
                </div>
              </div>
            )}

            {selectedFile && selectedVersion !== null && (
              <div className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-2 text-xs">
                {checkpointMutationsSupported && origin ? (
                  <>
                    <span className="shrink-0">Original</span>
                    <CopyablePath
                      displayText={origin.displayPath}
                      copyText={origin.displayPath}
                      className="text-foreground font-mono text-[11px]"
                    />
                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                      {restoredPath && <span>Restored to {restoredPath}; recovery copy retained.</span>}
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
                    {source === 'codex'
                      ? 'Original path unavailable — Codex session metadata is not a trusted restore origin. Checkpoint restore is unavailable.'
                      : 'Original path unknown — use Save as… (the session log this is recovered from may have been pruned).'}
                  </span>
                )}
              </div>
            )}

            {selectedFile && (
              <div className="text-muted-foreground flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[11px]">
                <span>Source: {selectedFile.source === 'codex' ? 'Codex' : 'Claude Code'}</span>
                <span className="max-w-full break-all select-text">
                  Provenance: {selectedFile.provenance.sourceFile}
                </span>
                {selectedFile.provenance.archived && <span>Archived</span>}
              </div>
            )}

            {compareError && (
              <div
                role="alert"
                className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-xs"
              >
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

      {checkpointMutationsSupported && (
        <RecoveryCopies
          copies={recoveryCopies}
          loading={recoveryLoading}
          onRefresh={() => void loadRecoveryCopies()}
          onRestore={async (id) => {
            if (!window.confirm('Restore this recovery copy over its original file?')) return;
            try {
              await api.restoreCheckpointRecoveryCopy(source, id);
              await loadRecoveryCopies();
            } catch (err) {
              setRecoveryError(errText(err));
            }
          }}
          onDelete={async (id) => {
            if (!window.confirm('Delete this recovery copy? This cannot be undone.')) return;
            try {
              await api.deleteCheckpointRecoveryCopy(source, id);
              await loadRecoveryCopies();
            } catch (err) {
              setRecoveryError(errText(err));
            }
          }}
        />
      )}
    </div>
  );
};

const RecoveryCopies = ({
  copies,
  loading,
  onRefresh,
  onRestore,
  onDelete,
}: Readonly<{
  copies: RecoveryCopy[];
  loading: boolean;
  onRefresh: () => void;
  onRestore: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}>): JSX.Element => (
  <section className="border-border/50 border-t px-4 py-4">
    <div className="flex items-center justify-between gap-2">
      <div>
        <p className="text-foreground text-xs font-medium">Recovery copies</p>
        <p className="text-muted-foreground mt-0.5 text-[11px]">
          Restore keeps the pre-write bytes in this private local store until you delete them.
        </p>
      </div>
      <Button variant="ghost" size="sm" disabled={loading} onClick={onRefresh}>
        Refresh
      </Button>
    </div>
    {loading && copies.length === 0 && (
      <p role="status" className="text-muted-foreground mt-3 text-xs">Loading recovery copies…</p>
    )}
    {!loading && copies.length === 0 && (
      <p className="text-muted-foreground mt-3 text-xs">No recovery copies are retained.</p>
    )}
    {copies.length > 0 && (
      <div className="mt-3 flex flex-col gap-2">
        {copies.map((copy) => (
          <div key={copy.id} className="border-border/50 flex flex-wrap items-center gap-3 rounded-md border px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-foreground truncate font-mono text-xs">{copy.targetLabel}</p>
              <p className="text-muted-foreground mt-0.5 text-[10px]">
                {copy.source} · v{copy.version} · {formatBytes(copy.byteSize)} ·{' '}
                {new Date(copy.createdAt).toLocaleString()}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" onClick={() => void onRestore(copy.id)}>
                Restore copy
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void onDelete(copy.id)}>
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>
    )}
  </section>
);

interface SessionRowProps {
  session: SessionGroup;
  selected: boolean;
  onSelect: () => void;
}

const SessionRow = ({ session, selected, onSelect }: Readonly<SessionRowProps>): JSX.Element => (
  <Button
    variant="ghost"
    aria-current={selected || undefined}
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
  file: SourceCheckpointGroup;
  selected: boolean;
  onSelect: () => void;
}

const FileRow = ({ file, selected, onSelect }: Readonly<FileRowProps>): JSX.Element => (
  <Button
    variant="ghost"
    aria-current={selected || undefined}
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
    aria-current={selected || undefined}
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
  if (loading)
    return (
      <p role="status" className="text-muted-foreground text-xs">
        Loading…
      </p>
    );
  if (error) {
    return (
      <div role="alert" className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-xs">
        {error}
      </div>
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
