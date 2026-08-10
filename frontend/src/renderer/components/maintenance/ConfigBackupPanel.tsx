import { JSX, useEffect, useState } from 'react';
import { api, isDesktopMode } from '@renderer/api';
import { confirm } from '@renderer/components/common/ConfirmDialog';
import { Button } from '@renderer/components/ui/button';
import { Checkbox } from '@renderer/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { useStore } from '@renderer/store';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { AlertTriangle, Download, Loader2, RotateCcw, Trash2, Upload } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { DryRunConfirmDialog } from './DryRunConfirmDialog';

import type { ImportPreview, Manifest } from '@shared/types/api';

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function backupBytes(backup: Manifest): number {
  return backup.files.reduce((sum, file) => sum + file.size, 0);
}

export const ConfigBackupPanel = (): JSX.Element => {
  const connectionMode = useStore(useShallow((s) => s.connectionMode));
  const canAct = isDesktopMode() && connectionMode === 'local';

  const [backups, setBackups] = useState<Manifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [captureLabel, setCaptureLabel] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Manifest | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [exportSecrets, setExportSecrets] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [checkedCategories, setCheckedCategories] = useState<string[]>([]);

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setBackups(await api.maintenance.listConfigBackups());
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runMutation = async (op: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await op();
      await load();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCapture = (): void => {
    void runMutation(async () => {
      await api.maintenance.captureConfig(captureLabel.trim());
      setCaptureLabel('');
    });
  };

  const handleRestore = async (backup: Manifest): Promise<void> => {
    const proceed = await confirm({
      title: 'Restore whole profile',
      message: `Overwrite your current config with "${backup.label || backup.id}" (${backup.files.length} files)? Each replaced file is backed up (.bak) first.`,
      confirmLabel: 'Restore',
      variant: 'danger',
    });
    if (proceed) await runMutation(() => api.maintenance.restoreConfig(backup.id, []));
  };

  const handleConfirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return;
    await runMutation(() => api.maintenance.deleteConfigBackup(pendingDelete.id));
    setPendingDelete(null);
  };

  const handleExport = async (id: string): Promise<void> => {
    await runMutation(() => api.maintenance.exportBackup(id, exportSecrets));
    setExportingId(null);
    setExportSecrets(false);
  };

  const handleImport = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.maintenance.validateImportDialog();
      // archivePath === "" is the user cancelling the native OpenFile dialog.
      if (!next.archivePath) return;
      setPreview(next);
      setCheckedCategories([]);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleCategory = (category: string): void => {
    setCheckedCategories((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]
    );
  };

  const handleApplyImport = async (): Promise<void> => {
    if (!preview) return;
    await runMutation(() => api.maintenance.applyImport(preview.archivePath, checkedCategories));
    setPreview(null);
    setCheckedCategories([]);
  };

  return (
    <div className="flex flex-col">
      <div className="border-border/50 flex items-start justify-between gap-2 border-b px-4 py-3">
        <div>
          <p className="text-foreground text-sm font-medium">Config Backup</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Capture, export, and import your whole user-authored config. Exports strip secrets by
            default; imported hooks always land disabled and every category is confirmed
            individually.
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => void load()}>
          {loading && <Loader2 className="size-3.5 animate-spin" />}
          Refresh
        </Button>
      </div>

      {!canAct && (
        <div className="border-border/50 bg-card/50 text-muted-foreground border-b px-4 py-2 text-xs">
          Config backup operates on this local machine only.
        </div>
      )}
      {error && (
        <div className="border-border/50 bg-destructive/10 text-destructive border-b px-4 py-2 text-xs">
          {error}
        </div>
      )}

      <div className="border-border/50 flex flex-wrap items-end gap-2 border-b px-4 py-3">
        <label className="text-muted-foreground flex flex-col gap-1 text-xs">
          Label (optional)
          <Input
            value={captureLabel}
            disabled={!canAct || busy}
            placeholder="e.g. before-experiment"
            onChange={(e) => setCaptureLabel(e.target.value)}
            className="border-border/50 bg-card/50 text-foreground min-w-48 rounded-sm border px-2 py-1 text-xs"
          />
        </label>
        <Button variant="default" size="sm" disabled={!canAct || busy} onClick={handleCapture}>
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          Capture
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!canAct || busy}
          onClick={() => void handleImport()}
        >
          <Upload className="size-3.5" />
          Import…
        </Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground px-4 py-3 text-xs">Loading…</p>
      ) : backups.length === 0 ? (
        <div className="text-muted-foreground flex flex-col items-center justify-center py-12 text-sm">
          No config backups yet.
        </div>
      ) : (
        <ul className="divide-border/50 divide-y">
          {backups.map((backup) => (
            <li key={backup.id} className="flex flex-col gap-2 px-4 py-2">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-foreground truncate text-sm">{backup.label || backup.id}</p>
                    {backup.secretsIncluded && (
                      <span className="rounded-sm bg-amber-500/15 px-1.5 py-px text-[10px] font-medium text-amber-500">
                        secrets included
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {new Date(backup.createdMs).toLocaleString()} · {backup.files.length}{' '}
                    {backup.files.length === 1 ? 'file' : 'files'}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canAct || busy}
                    onClick={() => void handleRestore(backup)}
                  >
                    <RotateCcw className="size-3.5" />
                    Restore
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canAct || busy}
                    onClick={() => {
                      setExportingId(exportingId === backup.id ? null : backup.id);
                      setExportSecrets(false);
                    }}
                  >
                    <Download className="size-3.5" />
                    Export
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={!canAct || busy}
                    onClick={() => setPendingDelete(backup)}
                  >
                    <Trash2 className="size-3.5" />
                    Delete
                  </Button>
                </div>
              </div>

              {exportingId === backup.id && (
                <div className="border-border/50 flex flex-wrap items-center gap-3 border-t pt-2">
                  <Label
                    htmlFor="config-backup-export-secrets"
                    className="text-muted-foreground flex items-center gap-2 text-xs"
                  >
                    <Checkbox
                      id="config-backup-export-secrets"
                      checked={exportSecrets}
                      onCheckedChange={(checked) => setExportSecrets(checked === true)}
                      className="accent-destructive size-3.5 shrink-0"
                    />
                    Include secrets (danger — ships live credentials verbatim)
                  </Label>
                  <Button
                    variant="default"
                    size="sm"
                    disabled={!canAct || busy}
                    onClick={() => void handleExport(backup.id)}
                  >
                    {busy && <Loader2 className="size-3.5 animate-spin" />}
                    Export archive
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setExportingId(null)}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {pendingDelete && (
        <DryRunConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null);
          }}
          paths={pendingDelete.files.map((file) => file.relPath)}
          totalBytes={backupBytes(pendingDelete)}
          fileCount={pendingDelete.files.length}
          busy={busy}
          error={error}
          onDeletePermanently={() => void handleConfirmDelete()}
        />
      )}

      {preview && (
        <ImportReviewDialog
          preview={preview}
          checked={checkedCategories}
          busy={busy}
          error={error}
          onToggle={toggleCategory}
          onApply={() => void handleApplyImport()}
          onCancel={() => {
            setPreview(null);
            setCheckedCategories([]);
          }}
        />
      )}
    </div>
  );
};

interface ImportReviewDialogProps {
  preview: ImportPreview;
  checked: string[];
  busy: boolean;
  error: string | null;
  onToggle: (category: string) => void;
  onApply: () => void;
  onCancel: () => void;
}

// The security-critical review screen. There is deliberately no "import all"
// action: each category carries its own unchecked-by-default checkbox and Apply
// sends ONLY the checked set (disabled while empty), so nothing imports without
// an explicit per-category confirmation.
const ImportReviewDialog = ({
  preview,
  checked,
  busy,
  error,
  onToggle,
  onApply,
  onCancel,
}: Readonly<ImportReviewDialogProps>): JSX.Element => (
  <Dialog
    open
    onOpenChange={(open) => {
      if (!open) onCancel();
    }}
  >
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Review import</DialogTitle>
        <DialogDescription>
          Nothing is written until you press Apply, and only the categories you check are imported.
        </DialogDescription>
      </DialogHeader>

      {preview.secretsIncluded && (
        <div className="border-border/50 bg-amber-500/10 flex items-center gap-2 rounded-md border px-3 py-2 text-xs text-amber-500">
          <AlertTriangle className="size-3.5 shrink-0" />
          This archive was exported WITH secrets — imported values may contain live credentials.
        </div>
      )}

      <div className="max-h-72 space-y-3 overflow-y-auto">
        <section>
          <p className="text-foreground text-xs font-bold">
            Hooks in this profile will be imported DISABLED (never auto-run)
          </p>
          {preview.hookCommands.length === 0 ? (
            <p className="text-muted-foreground mt-1 text-xs">No hook commands.</p>
          ) : (
            <pre className="border-border/50 bg-card/50 text-muted-foreground mt-1 max-h-32 overflow-auto rounded-md border p-2 font-mono text-[11px] whitespace-pre-wrap">
              {preview.hookCommands.join('\n')}
            </pre>
          )}
        </section>

        <section>
          <p className="text-foreground text-xs font-medium">Permission rules</p>
          {preview.permissionRules.length === 0 ? (
            <p className="text-muted-foreground mt-1 text-xs">No permission rules.</p>
          ) : (
            <pre className="border-border/50 bg-card/50 text-muted-foreground mt-1 max-h-32 overflow-auto rounded-md border p-2 font-mono text-[11px] whitespace-pre-wrap">
              {preview.permissionRules.join('\n')}
            </pre>
          )}
        </section>

        <section>
          <p className="text-foreground mb-1 text-xs font-medium">
            Categories to import ({checked.length}/{preview.categories.length} selected)
          </p>
          {preview.categories.length === 0 ? (
            <p className="text-muted-foreground text-xs">Nothing importable in this archive.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {preview.categories.map((category) => (
                <Label
                  key={category}
                  htmlFor={`config-backup-category-${category}`}
                  className="border-border/50 flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
                >
                  <Checkbox
                    id={`config-backup-category-${category}`}
                    checked={checked.includes(category)}
                    onCheckedChange={() => onToggle(category)}
                    className="accent-primary size-3.5 shrink-0"
                  />
                  <span className="text-foreground font-mono">{category}</span>
                </Label>
              ))}
            </div>
          )}
        </section>
      </div>

      {error && <p className="text-destructive text-xs">{error}</p>}

      <DialogFooter>
        <Button variant="outline" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="default"
          size="sm"
          disabled={busy || checked.length === 0}
          onClick={onApply}
        >
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          Apply {checked.length} {checked.length === 1 ? 'category' : 'categories'}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
