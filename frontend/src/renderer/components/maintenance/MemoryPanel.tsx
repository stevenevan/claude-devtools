import { JSX, useEffect, useState } from 'react';
import { api, isDesktopMode } from '@renderer/api';
import { confirm } from '@renderer/components/common/ConfirmDialog';
import { Button } from '@renderer/components/ui/button';
import { useStore } from '@renderer/store';

import { DryRunConfirmDialog } from './DryRunConfirmDialog';
import { MemoryFileEditor } from './MemoryFileEditor';

import type {
  MemoryDir,
  MemoryFile,
  MemoryFinding,
  MemoryIndexFix,
  MemoryReport,
} from '@shared/types/api';

const KIND_BADGE: Record<string, string> = {
  project: 'bg-sky-500/15 text-sky-500',
  agent: 'bg-violet-500/15 text-violet-500',
};

const TYPE_BADGE: Record<string, string> = {
  user: 'bg-sky-500/15 text-sky-500',
  feedback: 'bg-amber-500/15 text-amber-500',
  project: 'bg-emerald-500/15 text-emerald-500',
  reference: 'bg-violet-500/15 text-violet-500',
};

const FINDING_BADGE: Record<string, string> = {
  'orphan-file': 'bg-amber-500/15 text-amber-500',
  'dangling-index': 'bg-red-500/15 text-red-500',
  'dangling-link': 'bg-sky-500/15 text-sky-500',
  'duplicate-slug': 'bg-violet-500/15 text-violet-500',
};

const FINDING_LABEL: Record<string, string> = {
  'orphan-file': 'Orphan file',
  'dangling-index': 'Dangling index',
  'dangling-link': 'Dangling link',
  'duplicate-slug': 'Duplicate slug',
};

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const MemoryPanel = (): JSX.Element => {
  const connectionMode = useStore((s) => s.connectionMode);
  const canAct = isDesktopMode() && connectionMode === 'local';

  const [dirs, setDirs] = useState<MemoryDir[]>([]);
  const [dirsError, setDirsError] = useState<string | null>(null);
  const [selectedDirId, setSelectedDirId] = useState('');

  const [report, setReport] = useState<MemoryReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<MemoryFile | null>(null);
  const [mutating, setMutating] = useState(false);
  const [mutateError, setMutateError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setDirs(await api.maintenance.listMemoryDirs());
      } catch (err) {
        setDirsError(errText(err));
      }
    })();
  }, []);

  useEffect(() => {
    if (selectedDirId || dirs.length === 0) return;
    setSelectedDirId(dirs[0].id);
  }, [dirs, selectedDirId]);

  const rescan = async (dirID: string): Promise<void> => {
    if (!dirID) return;
    setReportLoading(true);
    setReportError(null);
    try {
      setReport(await api.maintenance.memoryIntegrity(dirID));
    } catch (err) {
      setReportError(errText(err));
    } finally {
      setReportLoading(false);
    }
  };

  useEffect(() => {
    setSelectedFileName(null);
    setEditorDirty(false);
    void rescan(selectedDirId);
    // Re-scan on dir switch; rescan is stable per render for this effect's needs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDirId]);

  const guardDirty = async (): Promise<boolean> => {
    if (!editorDirty) return true;
    return confirm({
      title: 'Discard unsaved changes?',
      message: 'The current file has unsaved changes. Switching will discard them.',
      confirmLabel: 'Discard',
      variant: 'danger',
    });
  };

  const selectDir = async (id: string): Promise<void> => {
    if (!(await guardDirty())) return;
    setSelectedDirId(id);
  };

  const selectFile = async (fileName: string): Promise<void> => {
    if (!(await guardDirty())) return;
    setEditorDirty(false);
    setSelectedFileName(fileName);
  };

  const applyFix = async (fix: MemoryIndexFix): Promise<void> => {
    setMutating(true);
    setMutateError(null);
    try {
      await api.maintenance.applyMemoryIndexFix(selectedDirId, fix);
      await rescan(selectedDirId);
    } catch (err) {
      setMutateError(errText(err));
    } finally {
      setMutating(false);
    }
  };

  const handleConfirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return;
    setMutating(true);
    setMutateError(null);
    try {
      await api.maintenance.deleteMemoryFile(selectedDirId, pendingDelete.fileName);
      if (selectedFileName === pendingDelete.fileName) {
        setSelectedFileName(null);
        setEditorDirty(false);
      }
      setPendingDelete(null);
      await rescan(selectedDirId);
    } catch (err) {
      setMutateError(errText(err));
    } finally {
      setMutating(false);
    }
  };

  const selectedDir = dirs.find((d) => d.id === selectedDirId) ?? null;
  const isEmptyAgentDir =
    !!report && report.dir.kind === 'agent' && report.files.length === 0 && report.findings.length === 0;

  return (
    <div className="flex flex-col">
      <div className="border-border/50 border-b px-4 py-3">
        <p className="text-foreground text-sm font-medium">Memory</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Integrity-check per-project and per-agent memory dirs, edit MEMORY.md and fact files, and
          apply index fixes. Only MEMORY.md index add/remove is ever auto-applied.
        </p>
      </div>

      {!canAct && (
        <div className="border-border/50 bg-card/50 text-muted-foreground border-b px-4 py-2 text-xs">
          Memory edits operate on this local machine only.
        </div>
      )}
      {dirsError && (
        <div className="border-border/50 bg-destructive/10 text-destructive border-b px-4 py-2 text-xs">
          {dirsError}
        </div>
      )}
      {reportError && (
        <div className="border-border/50 bg-destructive/10 text-destructive border-b px-4 py-2 text-xs">
          {reportError}
        </div>
      )}
      {mutateError && (
        <div className="border-border/50 bg-destructive/10 text-destructive border-b px-4 py-2 text-xs">
          {mutateError}
        </div>
      )}

      <div className="border-border/50 flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <label className="text-muted-foreground flex items-center gap-1 text-xs">
          Memory dir
          <select
            value={selectedDirId}
            onChange={(e) => void selectDir(e.target.value)}
            className="border-border/50 bg-card/50 text-foreground rounded-sm border px-2 py-1 text-xs"
          >
            {dirs.length === 0 && <option value="">No memory dirs</option>}
            {dirs.map((dir) => (
              <option key={dir.id} value={dir.id}>
                {dir.label}
              </option>
            ))}
          </select>
        </label>
        {selectedDir && (
          <span
            className={`rounded-sm px-1.5 py-px text-[10px] font-medium ${KIND_BADGE[selectedDir.kind] ?? 'bg-card/50 text-muted-foreground'}`}
          >
            {selectedDir.kind}
          </span>
        )}
      </div>

      {reportLoading ? (
        <p className="text-muted-foreground px-4 py-3 text-xs">Loading…</p>
      ) : report ? (
        <>
          {isEmptyAgentDir && (
            <div className="border-border/50 bg-card/50 text-muted-foreground border-b px-4 py-2 text-xs">
              This agent-memory directory is empty. Use the Junk maintenance tab to sweep empty
              dirs.
            </div>
          )}

          <FindingsSection
            findings={report.findings}
            canAct={canAct}
            mutating={mutating}
            onApplyFix={(fix) => void applyFix(fix)}
          />

          <div className="flex">
            <div className="border-border/50 flex w-64 shrink-0 flex-col border-r">
              <FileList
                files={report.files}
                selectedFileName={selectedFileName}
                onSelect={(fileName) => void selectFile(fileName)}
              />
            </div>

            <div className="flex-1">
              {selectedFileName ? (
                <MemoryFileEditor
                  key={selectedFileName}
                  dirID={selectedDirId}
                  fileName={selectedFileName}
                  canAct={canAct}
                  onSaved={() => void rescan(selectedDirId)}
                  onDirtyChange={setEditorDirty}
                  onRequestDelete={() => {
                    const file = report.files.find((f) => f.fileName === selectedFileName);
                    if (!file) return;
                    setMutateError(null);
                    setPendingDelete(file);
                  }}
                />
              ) : (
                <p className="text-muted-foreground px-4 py-3 text-xs">Select a file to edit.</p>
              )}
            </div>
          </div>
        </>
      ) : (
        <p className="text-muted-foreground px-4 py-3 text-xs">Select a memory dir.</p>
      )}

      {pendingDelete && (
        <DryRunConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null);
          }}
          paths={[selectedDir ? `${selectedDir.path}/${pendingDelete.fileName}` : pendingDelete.fileName]}
          totalBytes={0}
          fileCount={1}
          busy={mutating}
          error={mutateError}
          onMoveToTrash={() => void handleConfirmDelete()}
        />
      )}
    </div>
  );
};

interface FindingsSectionProps {
  findings: MemoryFinding[];
  canAct: boolean;
  mutating: boolean;
  onApplyFix: (fix: MemoryIndexFix) => void;
}

const FindingsSection = (props: Readonly<FindingsSectionProps>): JSX.Element => {
  const { findings, canAct, mutating, onApplyFix } = props;
  return (
    <div className="border-border/50 border-b px-4 py-3">
      <p className="text-foreground mb-2 text-xs font-medium">Integrity ({findings.length})</p>
      {findings.length === 0 ? (
        <p className="text-muted-foreground text-xs">No integrity findings.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {findings.map((finding, index) => (
            <FindingRow
              key={`${finding.kind}:${finding.file}:${index}`}
              finding={finding}
              canAct={canAct}
              mutating={mutating}
              onApplyFix={onApplyFix}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface FindingRowProps {
  finding: MemoryFinding;
  canAct: boolean;
  mutating: boolean;
  onApplyFix: (fix: MemoryIndexFix) => void;
}

const FindingRow = ({
  finding,
  canAct,
  mutating,
  onApplyFix,
}: Readonly<FindingRowProps>): JSX.Element => {
  const { fix } = finding;
  return (
    <div className="border-border/50 rounded-md border px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`rounded-sm px-1.5 py-px text-[10px] font-medium ${FINDING_BADGE[finding.kind] ?? 'bg-card/50 text-muted-foreground'}`}
          >
            {FINDING_LABEL[finding.kind] ?? finding.kind}
          </span>
          <span className="text-foreground truncate font-mono text-xs" title={finding.file}>
            {finding.file}
          </span>
        </div>
        {fix && (
          <Button
            variant="outline"
            size="sm"
            disabled={!canAct || mutating}
            onClick={() => onApplyFix(fix)}
          >
            Apply fix
          </Button>
        )}
      </div>
      <p className="text-muted-foreground mt-1 text-[11px]">{finding.detail}</p>
      {finding.kind === 'dangling-link' && (
        <p className="text-muted-foreground mt-1 text-[11px]">
          Allowed forward-link convention, not an error — a link may point at a memory not yet
          written.
        </p>
      )}
      {finding.kind === 'duplicate-slug' && (
        <p className="text-muted-foreground mt-1 text-[11px]">
          Two fact files share a slug — merge them manually; no automatic fix is offered.
        </p>
      )}
    </div>
  );
};

interface FileListProps {
  files: MemoryFile[];
  selectedFileName: string | null;
  onSelect: (fileName: string) => void;
}

const FileList = ({ files, selectedFileName, onSelect }: Readonly<FileListProps>): JSX.Element => {
  if (files.length === 0) {
    return <p className="text-muted-foreground px-3 pt-3 text-xs">No fact files.</p>;
  }
  return (
    <div className="flex flex-col gap-0.5 p-2">
      {files.map((file) => {
        const isSelected = file.fileName === selectedFileName;
        return (
          <Button
            key={file.fileName}
            variant={isSelected ? 'secondary' : 'ghost'}
            size="sm"
            className="h-auto flex-col items-start gap-0.5 py-1.5"
            onClick={() => onSelect(file.fileName)}
          >
            <span className="flex w-full items-center gap-1.5">
              <span className="text-foreground truncate text-xs font-medium">{file.fileName}</span>
              {file.type && (
                <span
                  className={`ml-auto shrink-0 rounded-sm px-1 py-px text-[10px] font-medium ${TYPE_BADGE[file.type] ?? 'bg-card/50 text-muted-foreground'}`}
                >
                  {file.type}
                </span>
              )}
            </span>
            {file.description && (
              <span className="text-muted-foreground w-full truncate text-[10px]">
                {file.description}
              </span>
            )}
          </Button>
        );
      })}
    </div>
  );
};
