import { useMemo, useState } from 'react';

import { cn } from '@renderer/lib/utils';
import {
  comboFromEvent,
  findConflicts,
  resolveBindings,
  SHORTCUT_ACTIONS,
} from '@renderer/shortcuts/shortcutRegistry';
import { useStore } from '@renderer/store';
import { createLogger } from '@shared/utils/logger';
import { Keyboard, RotateCcw } from 'lucide-react';

import { SettingsSectionHeader } from '../components';

const logger = createLogger('Component:KeyboardShortcutsSection');

export const KeyboardShortcutsSection = (): React.JSX.Element => {
  const appConfig = useStore((s) => s.appConfig);
  const setShortcutOverride = useStore((s) => s.setShortcutOverride);
  const resetAllShortcuts = useStore((s) => s.resetAllShortcuts);
  const overrides = useMemo(
    () => appConfig?.shortcuts?.overrides ?? {},
    [appConfig?.shortcuts?.overrides]
  );
  const [capturingId, setCapturingId] = useState<string | null>(null);

  const bindings = useMemo(() => resolveBindings(overrides), [overrides]);
  const conflicts = useMemo(() => findConflicts(bindings), [bindings]);
  const conflictedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of conflicts) {
      for (const id of c.actionIds) ids.add(id);
    }
    return ids;
  }, [conflicts]);

  const handleCaptureKeyDown = (actionId: string) => (e: React.KeyboardEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      setCapturingId(null);
      return;
    }
    // Require at least one non-modifier key
    if (e.key === 'Meta' || e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt') {
      return;
    }
    const combo = comboFromEvent(e.nativeEvent);
    // Check for conflicts before persisting
    const next = resolveBindings({ ...overrides, [actionId]: combo });
    const clashIncludesOther = (c: { actionIds: string[] }): boolean => {
      if (!c.actionIds.includes(actionId)) return false;
      for (const id of c.actionIds) {
        if (id !== actionId) return true;
      }
      return false;
    };
    const clash = findConflicts(next).find(clashIncludesOther);
    if (clash) {
      const other = clash.actionIds.find((id) => id !== actionId) ?? 'another action';
      logger.warn(`Shortcut ${combo} already bound to ${other}; skipping rebind`);
      setCapturingId(null);
      return;
    }
    void setShortcutOverride(actionId, combo);
    setCapturingId(null);
  };

  return (
    <div>
      <SettingsSectionHeader title="Keyboard Shortcuts" />
      <p className="text-muted-foreground mb-4 text-sm">
        Click a shortcut to rebind. Press Escape to cancel. Conflicts (highlighted in red) are
        rejected.
      </p>

      <div className="mb-3 flex items-center justify-end">
        <button
          onClick={() => void resetAllShortcuts()}
          disabled={Object.keys(overrides).length === 0}
          className="border-border hover:bg-surface-raised text-text-secondary flex items-center gap-1 rounded-sm border px-2 py-1 text-[11px] disabled:opacity-40"
        >
          <RotateCcw className="size-2.5" />
          Reset all
        </button>
      </div>

      <div className="border-border divide-border-subtle bg-background/50 divide-y rounded-xs border">
        {SHORTCUT_ACTIONS.map((action) => {
          const current = bindings[action.id];
          const isOverridden = current !== action.defaultCombo;
          const isConflicted = conflictedIds.has(action.id);
          const isCapturing = capturingId === action.id;
          return (
            <div key={action.id} className="flex items-center justify-between px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <Keyboard className="text-text-muted size-3" />
                <span className="text-foreground">{action.label}</span>
                {action.scope === 'session' && (
                  <span className="text-text-muted text-[9px] uppercase">session</span>
                )}
                {isOverridden && (
                  <span className="text-[9px] text-amber-400">custom</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onKeyDown={handleCaptureKeyDown(action.id)}
                  onClick={() => setCapturingId(action.id)}
                  onBlur={() => setCapturingId((prev) => (prev === action.id ? null : prev))}
                  autoFocus={isCapturing}
                  className={cn(
                    'border-border bg-card min-w-24 rounded-sm border px-1.5 py-0.5 text-right font-mono text-[11px]',
                    isCapturing && 'border-amber-500/60 ring-1 ring-amber-500/40',
                    isConflicted && 'border-rose-500/60 ring-1 ring-rose-500/40'
                  )}
                >
                  {isCapturing ? 'Press keys…' : current}
                </button>
                {isOverridden && (
                  <button
                    onClick={() => void setShortcutOverride(action.id, null)}
                    className="text-text-muted hover:text-text text-[10px]"
                    title={`Reset to ${action.defaultCombo}`}
                  >
                    <RotateCcw className="size-2.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {conflicts.length > 0 && (
        <div className="mt-3 rounded-xs border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
          {conflicts.length} conflict{conflicts.length === 1 ? '' : 's'} detected — duplicate
          combos cannot both fire. Rebind the affected actions.
        </div>
      )}
    </div>
  );
};
