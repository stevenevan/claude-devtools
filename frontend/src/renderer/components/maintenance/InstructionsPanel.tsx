import { JSX, useEffect, useState } from 'react';
import { api, isDesktopMode } from '@renderer/api';
import { confirm } from '@renderer/components/common/ConfirmDialog';
import { useStore } from '@renderer/store';

import { CommandDetailEditor } from './CommandDetailEditor';
import { ContextCostMeter } from './ContextCostMeter';
import { DryRunConfirmDialog } from './DryRunConfirmDialog';
import {
  DELETABLE_BUCKETS,
  InstructionFileTree,
  instructionBucket,
} from './InstructionFileTree';
import { InstructionFileEditor } from './InstructionFileEditor';

import type { InstructionFile } from '@shared/types';

export const InstructionsPanel = (): JSX.Element => {
  const connectionMode = useStore((s) => s.connectionMode);
  const canAct = isDesktopMode() && connectionMode === 'local';

  const [files, setFiles] = useState<InstructionFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [selectedRelPath, setSelectedRelPath] = useState<string | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<InstructionFile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const refreshFiles = async (): Promise<void> => {
    setFilesLoading(true);
    setFilesError(null);
    try {
      const result = await api.maintenance.listInstructionFiles();
      setFiles(result);
    } catch (err) {
      setFilesError(err instanceof Error ? err.message : String(err));
    } finally {
      setFilesLoading(false);
    }
  };

  useEffect(() => {
    void refreshFiles();
    // Load once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedRelPath || files.length === 0) return;
    const claudeMd = files.find((f) => f.relPath === 'CLAUDE.md');
    setSelectedRelPath(claudeMd ? claudeMd.relPath : files[0].relPath);
  }, [files, selectedRelPath]);

  const selectFile = async (relPath: string): Promise<void> => {
    if (editorDirty) {
      const proceed = await confirm({
        title: 'Discard unsaved changes?',
        message: 'The current file has unsaved changes. Switching files will discard them.',
        confirmLabel: 'Discard',
        variant: 'danger',
      });
      if (!proceed) return;
    }
    setEditorDirty(false);
    setSelectedRelPath(relPath);
  };

  const handleCreateRulesFile = (): void => {
    const name = window.prompt('New rules file name (e.g. my-rule.md)');
    if (!name?.trim()) return;
    void selectFile(`rules/${name.trim()}`);
  };

  const handleRequestDelete = (): void => {
    const file = files.find((f) => f.relPath === selectedRelPath);
    if (file) setPendingDelete(file);
  };

  const handleConfirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.maintenance.deleteInstructionFile(pendingDelete.relPath);
      setPendingDelete(null);
      setSelectedRelPath(null);
      await refreshFiles();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  const isNewFile = !!selectedRelPath && !files.some((f) => f.relPath === selectedRelPath);
  const bucket = selectedRelPath ? instructionBucket(selectedRelPath) : null;
  const deletable = !isNewFile && bucket !== null && DELETABLE_BUCKETS.has(bucket);

  return (
    <div className="flex flex-col">
      <div className="border-border/50 border-b px-4 py-3">
        <p className="text-foreground text-sm font-medium">Instructions</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Edit global CLAUDE.md, RTK.md, and rules/commands/tools files injected into every
          session.
        </p>
      </div>

      {!canAct && (
        <div className="border-border/50 bg-card/50 text-muted-foreground border-b px-4 py-2 text-xs">
          Editing operates on this local machine only.
        </div>
      )}
      {filesError && (
        <div className="border-border/50 bg-destructive/10 text-destructive border-b px-4 py-2 text-xs">
          {filesError}
        </div>
      )}

      {filesLoading ? (
        <p className="text-muted-foreground px-4 py-3 text-xs">Loading…</p>
      ) : (
        <div className="flex">
          <div className="border-border/50 flex w-64 shrink-0 flex-col border-r">
            {files.length === 0 && (
              <p className="text-muted-foreground px-3 pt-3 text-xs">No instruction files found.</p>
            )}
            <InstructionFileTree
              files={files}
              selectedRelPath={selectedRelPath}
              onSelect={(relPath) => void selectFile(relPath)}
              onCreateRulesFile={handleCreateRulesFile}
              canAct={canAct}
            />
            <ContextCostMeter files={files} />
          </div>

          <div className="flex-1">
            {selectedRelPath ? (
              bucket === 'commands' ? (
                <CommandDetailEditor
                  key={selectedRelPath}
                  relPath={selectedRelPath}
                  isNewFile={isNewFile}
                  deletable={deletable}
                  canAct={canAct}
                  onSaved={() => void refreshFiles()}
                  onDirtyChange={setEditorDirty}
                  onRequestDelete={handleRequestDelete}
                />
              ) : (
                <InstructionFileEditor
                  key={selectedRelPath}
                  relPath={selectedRelPath}
                  isNewFile={isNewFile}
                  deletable={deletable}
                  canAct={canAct}
                  onSaved={() => void refreshFiles()}
                  onDirtyChange={setEditorDirty}
                  onRequestDelete={handleRequestDelete}
                />
              )
            ) : (
              <p className="text-muted-foreground px-4 py-3 text-xs">Select a file to edit.</p>
            )}
          </div>
        </div>
      )}

      {pendingDelete && (
        <DryRunConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null);
          }}
          paths={[pendingDelete.relPath]}
          totalBytes={pendingDelete.bytes}
          fileCount={1}
          busy={deleting}
          error={deleteError}
          onMoveToTrash={() => void handleConfirmDelete()}
        />
      )}
    </div>
  );
};
