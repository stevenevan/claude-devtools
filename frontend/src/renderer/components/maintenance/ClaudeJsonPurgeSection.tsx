import { JSX, useEffect, useState } from 'react';
import { api } from '@renderer/api';
import { confirm } from '@renderer/components/common/ConfirmDialog';
import { CopyButton } from '@renderer/components/common/CopyButton';
import { Button } from '@renderer/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@renderer/components/ui/field';
import { formatBytes } from '@renderer/utils/formatters';
import { AlertTriangle, Loader2, RotateCcw } from 'lucide-react';

import type { ClaudeJSONBackup, ClaudeJSONProject, PurgeResult } from '@shared/types/api';

const HEALTH_CMD = 'claude --version';

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface ClaudeJsonPurgeSectionProps {
  projects: ClaudeJSONProject[];
  selected: string[];
  canAct: boolean;
  onAfterWrite: () => void;
}

// The Week 21 write affordance: a typed-confirm purge of provably-stale project
// entries plus app-side backup listing and full-file restore. All writes route
// through the guarded backend (PurgeClaudeJSONProjects / RestoreClaudeJSONAppBackup);
// this surface never edits ~/.claude.json directly.
export const ClaudeJsonPurgeSection = ({
  projects,
  selected,
  canAct,
  onAfterWrite,
}: Readonly<ClaudeJsonPurgeSectionProps>): JSX.Element => {
  const [appBackups, setAppBackups] = useState<ClaudeJSONBackup[]>([]);
  const [confirmText, setConfirmText] = useState('');
  const [purging, setPurging] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const [purgeResult, setPurgeResult] = useState<PurgeResult | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  const loadAppBackups = async (): Promise<void> => {
    try {
      setAppBackups(await api.listClaudeJSONAppBackups());
    } catch (err) {
      setPurgeError(errText(err));
    }
  };

  useEffect(() => {
    void loadAppBackups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedEntries = projects.filter((p) => selected.includes(p.path));
  const requiredPhrase = `purge ${selected.length} project entries`;
  const canPurge =
    canAct && selected.length > 0 && confirmText.trim() === requiredPhrase && !purging;

  const handlePurge = async (): Promise<void> => {
    setPurging(true);
    setPurgeError(null);
    try {
      const result = await api.purgeClaudeJSONProjects(selected);
      setPurgeResult(result);
      setConfirmText('');
      await loadAppBackups();
      onAfterWrite();
    } catch (err) {
      setPurgeError(errText(err));
    } finally {
      setPurging(false);
    }
  };

  const handleRestore = async (name: string): Promise<void> => {
    const confirmed = await confirm({
      title: 'Restore ~/.claude.json?',
      message:
        'This replaces the entire ~/.claude.json with this backup — reverting ALL state, ' +
        'INCLUDING your authentication, to the backup point. The current file is backed up first. ' +
        'The CLI also writes this file.',
      confirmLabel: 'Restore',
      variant: 'danger',
    });
    if (!confirmed) return;
    setRestoring(name);
    setPurgeError(null);
    try {
      await api.restoreClaudeJSONAppBackup(name);
      await loadAppBackups();
      onAfterWrite();
    } catch (err) {
      setPurgeError(errText(err));
    } finally {
      setRestoring(null);
    }
  };

  return (
    <div className="border-border/50 border-b px-4 py-3">
      <p className="text-foreground mb-2 text-xs font-medium">Purge stale project entries</p>

      {!canAct && (
        <div className="border-border/50 bg-card/50 text-muted-foreground mb-2 rounded-md border px-2 py-1.5 text-xs">
          Purge and restore operate on this local machine only.
        </div>
      )}

      {purgeError && (
        <div className="border-border/50 bg-destructive/10 text-destructive mb-2 rounded-md border px-2 py-1.5 text-xs">
          {purgeError}
        </div>
      )}

      {canAct && selected.length === 0 && !purgeResult && (
        <p className="text-muted-foreground text-xs">
          Select one or more <span className="text-foreground">stale</span> project entries above to
          purge them.
        </p>
      )}

      {canAct && selected.length > 0 && (
        <div className="mb-2 flex flex-col gap-2">
          <div className="border-border/50 bg-card/50 rounded-md border px-2 py-1.5">
            <p className="text-foreground mb-1 text-xs font-medium">
              {selected.length} entr{selected.length === 1 ? 'y' : 'ies'} will be removed
            </p>
            <div className="flex flex-col gap-0.5">
              {selectedEntries.map((entry) => (
                <div key={entry.path} className="flex items-center justify-between gap-2">
                  <span
                    className="text-muted-foreground min-w-0 truncate font-mono text-[11px]"
                    title={entry.path}
                  >
                    {entry.path}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-[10px]">
                    {formatBytes(entry.bytes)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-start gap-2 text-xs text-amber-500">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Credential and non-project keys are never touched. To confirm, type{' '}
              <span className="text-foreground font-mono">{requiredPhrase}</span> below.
            </span>
          </div>

          <Field className="flex-row items-center gap-2">
            <FieldLabel htmlFor="claude-json-purge-confirmation" className="sr-only">
              Purge confirmation
            </FieldLabel>
            <input
              id="claude-json-purge-confirmation"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={requiredPhrase}
              aria-describedby="claude-json-purge-confirmation-description"
              className="border-border/50 bg-card/50 text-foreground min-w-0 flex-1 rounded-sm border px-2 py-1 font-mono text-xs"
            />
            <Button
              variant="destructive"
              size="sm"
              disabled={!canPurge}
              onClick={() => void handlePurge()}
            >
              {purging && <Loader2 className="size-3.5 animate-spin" />}
              Purge
            </Button>
            <FieldDescription
              id="claude-json-purge-confirmation-description"
              className="sr-only"
            >
              Type {requiredPhrase} to confirm this purge.
            </FieldDescription>
          </Field>
        </div>
      )}

      {purgeResult && (
        <div className="border-border/50 bg-emerald-500/10 mb-2 rounded-md border px-2 py-2 text-xs">
          <p className="text-foreground font-medium">
            Removed {purgeResult.removedKeys.length} project entr
            {purgeResult.removedKeys.length === 1 ? 'y' : 'ies'} —{' '}
            {formatBytes(Math.max(0, purgeResult.bytesBefore - purgeResult.bytesAfter))} saved
          </p>
          <p className="text-muted-foreground mt-0.5">
            Pre-purge backup saved as{' '}
            <span className="text-foreground font-mono">{purgeResult.backupName}</span>.
          </p>
          <div className="mt-1.5 flex items-center gap-1">
            <span className="text-muted-foreground">Confirm the CLI is still healthy:</span>
            <code className="text-foreground bg-card/50 rounded-sm px-1 py-px font-mono">
              {HEALTH_CMD}
            </code>
            <CopyButton text={HEALTH_CMD} inline />
          </div>
        </div>
      )}

      <div className="mt-2">
        <p className="text-foreground mb-1 text-xs font-medium">
          App-side backups (pre-write, full copy)
        </p>
        {appBackups.length === 0 ? (
          <p className="text-muted-foreground text-xs">No app-side backups yet.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {appBackups.map((backup) => (
              <div
                key={backup.name}
                className="border-border/50 flex items-center justify-between gap-2 rounded-md border px-2 py-1"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="text-foreground truncate font-mono text-[11px]" title={backup.name}>
                    {backup.name}
                  </span>
                  <span className="text-muted-foreground text-[10px]">
                    {backup.modTime.toLocaleString()} · {formatBytes(backup.bytes)}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canAct || restoring !== null}
                  onClick={() => void handleRestore(backup.name)}
                >
                  {restoring === backup.name ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="size-3.5" />
                  )}
                  Restore
                </Button>
              </div>
            ))}
          </div>
        )}
        <p className="text-muted-foreground mt-1 text-[10px]">
          Restore reverts ALL ~/.claude.json state — including authentication — to the backup point.
        </p>
      </div>
    </div>
  );
};
