import { JSX, useEffect, useState } from 'react';
import { api, isDesktopMode } from '@renderer/api';
import { Switch } from '@renderer/components/ui/switch';
import { useStore } from '@renderer/store';
import { Loader2 } from 'lucide-react';

import { HookArmDialog } from './HookArmDialog';

import type { HookEntry, HookView } from '@shared/types/api';

interface HookRow extends HookEntry {
  readonly isEnabled: boolean;
}

function toRows(view: HookView): HookRow[] {
  return [
    ...view.enabled.map((entry) => ({ ...entry, isEnabled: true })),
    ...view.disabled.map((entry) => ({ ...entry, isEnabled: false })),
  ];
}

export const HooksPanel = (): JSX.Element => {
  const connectionMode = useStore((s) => s.connectionMode);
  const canAct = isDesktopMode() && connectionMode === 'local';

  const [view, setView] = useState<HookView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyFingerprint, setBusyFingerprint] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [armTarget, setArmTarget] = useState<HookEntry | null>(null);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      setView(await api.readHooks());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to read hooks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // Load once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDisable = async (entry: HookEntry): Promise<void> => {
    setToggleError(null);
    setBusyFingerprint(entry.fingerprint);
    try {
      await api.toggleHook(entry.event, entry.index, entry.fingerprint, false);
      await refresh();
    } catch (error) {
      setToggleError(error instanceof Error ? error.message : 'Failed to disable hook');
    } finally {
      setBusyFingerprint(null);
    }
  };

  const handleConfirmEnable = async (): Promise<void> => {
    if (!armTarget) return;
    setToggleError(null);
    setBusyFingerprint(armTarget.fingerprint);
    try {
      await api.toggleHook(armTarget.event, armTarget.index, armTarget.fingerprint, true);
      setArmTarget(null);
      await refresh();
    } catch (error) {
      setToggleError(error instanceof Error ? error.message : 'Failed to enable hook');
    } finally {
      setBusyFingerprint(null);
    }
  };

  const handleToggle = (row: HookRow, checked: boolean): void => {
    if (checked) {
      setArmTarget(row);
    } else {
      void handleDisable(row);
    }
  };

  if (loading && !view) {
    return (
      <div className="text-text-muted flex items-center gap-2 py-6 text-sm">
        <Loader2 className="size-4 animate-spin" />
        Loading hooks...
      </div>
    );
  }

  if (loadError && !view) {
    return (
      <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-xs">
        {loadError}
      </div>
    );
  }

  const rows = view ? toRows(view) : [];

  return (
    <div>
      <p className="text-text-muted text-xs">
        Enable or disable hook commands already defined in <code>~/.claude/settings.json</code>.
        Authoring new hooks or editing matchers still happens in a text editor.
      </p>

      {!canAct && (
        <p className="text-text-muted mt-2 text-xs">
          Hooks can only be toggled on this local machine.
        </p>
      )}

      {toggleError && <p className="text-destructive mt-2 text-xs">{toggleError}</p>}

      <div className="border-border bg-surface-raised divide-border-subtle mt-2 divide-y rounded-md border">
        {rows.length === 0 && (
          <div className="text-text-muted px-3 py-2 text-xs">No hooks configured</div>
        )}
        {rows.map((row) => (
          <div key={row.fingerprint} className="flex items-start justify-between gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="border-border bg-surface text-text rounded-sm border px-1.5 py-0.5 font-mono text-xs">
                  {row.event}
                </span>
                {row.matcher && (
                  <span className="text-text-muted font-mono text-xs">{row.matcher}</span>
                )}
              </div>
              <div className="mt-1 flex flex-col gap-0.5">
                {row.commands.map((command, idx) => (
                  <code
                    key={idx}
                    className="text-text font-mono text-xs break-all whitespace-pre-wrap"
                  >
                    {command}
                  </code>
                ))}
              </div>
            </div>
            <Switch
              checked={row.isEnabled}
              disabled={!canAct || busyFingerprint === row.fingerprint}
              onCheckedChange={(checked) => handleToggle(row, checked)}
            />
          </div>
        ))}
      </div>

      <HookArmDialog
        open={armTarget !== null}
        onOpenChange={(open) => {
          if (!open) setArmTarget(null);
        }}
        entry={armTarget}
        busy={busyFingerprint === armTarget?.fingerprint}
        error={toggleError}
        onConfirm={() => void handleConfirmEnable()}
      />
    </div>
  );
};
