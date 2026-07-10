import { JSX, useEffect, useState } from 'react';
import { api, isDesktopMode } from '@renderer/api';
import { confirm } from '@renderer/components/common/ConfirmDialog';
import { Button } from '@renderer/components/ui/button';
import { useStore } from '@renderer/store';
import { Loader2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { JsonDiffView } from './JsonDiffView';

// Compares top-level keys only (added/removed/changed) — enough to warn a
// restore will drop or overwrite keys without being a structural differ.
function diffTopLevelKeys(a: string, b: string): string[] {
  let objA: Record<string, unknown>;
  let objB: Record<string, unknown>;
  try {
    objA = JSON.parse(a);
    objB = JSON.parse(b);
  } catch {
    return [];
  }

  const keys = new Set([...Object.keys(objA), ...Object.keys(objB)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (JSON.stringify(objA[key]) !== JSON.stringify(objB[key])) changed.push(key);
  }
  return changed.sort();
}

export const SettingsDiffPanel = (): JSX.Element => {
  const {
    settingsGenerations,
    connectionMode,
    trashError,
    loadSettingsGenerations,
    restoreSettingsGeneration,
  } = useStore(
    useShallow((s) => ({
      settingsGenerations: s.settingsGenerations,
      connectionMode: s.connectionMode,
      trashError: s.trashError,
      loadSettingsGenerations: s.loadSettingsGenerations,
      restoreSettingsGeneration: s.restoreSettingsGeneration,
    }))
  );

  const [leftName, setLeftName] = useState('');
  const [rightName, setRightName] = useState('');
  const [leftText, setLeftText] = useState('');
  const [rightText, setRightText] = useState('');
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const canAct = isDesktopMode() && connectionMode === 'local';

  useEffect(() => {
    void loadSettingsGenerations();
    // Load once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (settingsGenerations.length === 0) return;
    if (!leftName) {
      setLeftName(
        settingsGenerations.includes('settings.json.bak')
          ? 'settings.json.bak'
          : settingsGenerations[0]
      );
    }
    if (!rightName) {
      setRightName(
        settingsGenerations.includes('settings.json') ? 'settings.json' : settingsGenerations[0]
      );
    }
  }, [settingsGenerations, leftName, rightName]);

  const fetchDiff = async (left: string, right: string): Promise<void> => {
    if (!left || !right) return;
    setDiffLoading(true);
    setDiffError(null);
    try {
      const [l, r] = await Promise.all([
        api.maintenance.readSettingsGeneration(left),
        api.maintenance.readSettingsGeneration(right),
      ]);
      setLeftText(l);
      setRightText(r);
    } catch (err) {
      setDiffError(err instanceof Error ? err.message : String(err));
    } finally {
      setDiffLoading(false);
    }
  };

  useEffect(() => {
    void fetchDiff(leftName, rightName);
    // fetchDiff is redefined every render; only the selected names matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftName, rightName]);

  useEffect(() => {
    return api.maintenance.onConfigFileChange(() => {
      void loadSettingsGenerations();
      void fetchDiff(leftName, rightName);
    });
    // fetchDiff is redefined every render; only the selected names matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftName, rightName]);

  const handleRestore = async (): Promise<void> => {
    setRestoring(true);
    try {
      const current = await api.maintenance.readSettingsGeneration('settings.json');
      const changedKeys = diffTopLevelKeys(leftText, current);
      const confirmed = await confirm({
        title: `Restore ${leftName}?`,
        message:
          (changedKeys.length > 0
            ? `Changed top-level keys: ${changedKeys.join(', ')}. `
            : 'No top-level key differences detected. ') +
          'This overwrites settings.json (current saved to .bak). The CLI also writes this file.',
        confirmLabel: 'Restore',
        variant: 'danger',
      });
      if (!confirmed) return;

      await restoreSettingsGeneration(leftName);
      await fetchDiff(leftName, rightName);
    } finally {
      setRestoring(false);
    }
  };

  const canRestore = canAct && !!leftName && leftName !== 'settings.json' && !restoring;

  return (
    <div className="flex flex-col">
      <div className="border-border/50 border-b px-4 py-3">
        <p className="text-foreground text-sm font-medium">Settings Diff</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Compare settings.json against its backup generations and restore an earlier one.
        </p>
      </div>

      {!canAct && (
        <div className="border-border/50 bg-card/50 text-muted-foreground border-b px-4 py-2 text-xs">
          Restore operates on this local machine only.
        </div>
      )}
      {(diffError || trashError) && (
        <div className="border-border/50 bg-destructive/10 text-destructive border-b px-4 py-2 text-xs">
          {diffError ?? trashError}
        </div>
      )}

      <div className="border-border/50 flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <label className="text-muted-foreground flex items-center gap-1 text-xs">
          Left
          <select
            value={leftName}
            onChange={(e) => setLeftName(e.target.value)}
            className="border-border/50 bg-card/50 text-foreground rounded-sm border px-2 py-1 text-xs"
          >
            {settingsGenerations.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-muted-foreground flex items-center gap-1 text-xs">
          Right
          <select
            value={rightName}
            onChange={(e) => setRightName(e.target.value)}
            className="border-border/50 bg-card/50 text-foreground rounded-sm border px-2 py-1 text-xs"
          >
            {settingsGenerations.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <Button
          variant="destructive"
          size="sm"
          disabled={!canRestore}
          onClick={() => void handleRestore()}
        >
          {restoring && <Loader2 className="size-3.5 animate-spin" />}
          Restore {leftName || 'selected'}
        </Button>
      </div>

      <div className="px-4 py-3">
        {diffLoading ? (
          <p className="text-muted-foreground text-xs">Loading…</p>
        ) : (
          <JsonDiffView
            left={leftText}
            right={rightText}
            leftLabel={leftName}
            rightLabel={rightName}
          />
        )}
      </div>
    </div>
  );
};
