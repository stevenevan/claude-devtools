/**
 * Shortcut registry — catalogue of user-rebindable keyboard actions.
 *
 * Sprint 33 extracts this from the hard-coded handlers in
 * `useKeyboardShortcuts.ts` so settings can present an editable table. The
 * runtime handler still owns dispatch — this module is the source of truth for
 * (a) the default combo per action and (b) conflict detection when the user
 * tries to rebind.
 */

export interface ShortcutAction {
  id: string;
  label: string;
  /** Canonical binding (e.g. `"Cmd+K"`, `"?"`, `"Space"`). */
  defaultCombo: string;
  /** Whether this action is scoped to session tabs (vs. app-wide). */
  scope?: 'app' | 'session';
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: 'open-command-palette', label: 'Open command palette', defaultCombo: 'Cmd+K' },
  { id: 'new-tab', label: 'New dashboard tab', defaultCombo: 'Cmd+T' },
  { id: 'close-tab', label: 'Close active tab', defaultCombo: 'Cmd+W' },
  { id: 'close-all-tabs', label: 'Close all tabs', defaultCombo: 'Cmd+Shift+W' },
  { id: 'toggle-sidebar', label: 'Toggle sidebar', defaultCombo: 'Cmd+B' },
  { id: 'refresh-session', label: 'Refresh current session', defaultCombo: 'Cmd+R' },
  { id: 'open-settings', label: 'Open settings', defaultCombo: 'Cmd+,' },
  { id: 'find-in-session', label: 'Find in session', defaultCombo: 'Cmd+F', scope: 'session' },
  { id: 'advanced-search', label: 'Advanced search', defaultCombo: 'Cmd+Shift+F' },
  { id: 'switch-context', label: 'Switch workspace context', defaultCombo: 'Cmd+Shift+K' },
  { id: 'next-turn', label: 'Jump to next turn', defaultCombo: 'j', scope: 'session' },
  { id: 'prev-turn', label: 'Jump to previous turn', defaultCombo: 'k', scope: 'session' },
  { id: 'toggle-flame-graph', label: 'Toggle flame graph', defaultCombo: 'f', scope: 'session' },
  { id: 'next-chunk', label: 'Next chunk boundary', defaultCombo: ']', scope: 'session' },
  { id: 'prev-chunk', label: 'Previous chunk boundary', defaultCombo: '[', scope: 'session' },
  { id: 'replay-toggle', label: 'Play/pause replay', defaultCombo: 'Space', scope: 'session' },
  { id: 'replay-step-forward', label: 'Replay step forward', defaultCombo: '.', scope: 'session' },
  { id: 'replay-step-back', label: 'Replay step back', defaultCombo: ',', scope: 'session' },
  { id: 'shortcut-cheat-sheet', label: 'Open shortcut cheat sheet', defaultCombo: '?' },
];

export function getAction(id: string): ShortcutAction | undefined {
  return SHORTCUT_ACTIONS.find((a) => a.id === id);
}

/**
 * Given the registry + user override map (action id → combo), return the
 * effective binding for each action. Empty/unknown overrides fall back to
 * defaults.
 */
export function resolveBindings(
  overrides: Record<string, string> | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const action of SHORTCUT_ACTIONS) {
    const override = overrides?.[action.id]?.trim();
    out[action.id] = override && override.length > 0 ? override : action.defaultCombo;
  }
  return out;
}

/**
 * Detect conflicts — two actions mapped to the same combo (same scope only).
 * Returns an array of { combo, actionIds } entries, one per conflict.
 */
export function findConflicts(
  bindings: Record<string, string>
): { combo: string; actionIds: string[] }[] {
  const bySignature = new Map<string, string[]>();
  for (const action of SHORTCUT_ACTIONS) {
    const combo = bindings[action.id];
    if (!combo) continue;
    const sig = `${action.scope ?? 'app'}::${combo.toLowerCase()}`;
    const list = bySignature.get(sig) ?? [];
    list.push(action.id);
    bySignature.set(sig, list);
  }
  const conflicts: { combo: string; actionIds: string[] }[] = [];
  for (const [sig, ids] of bySignature) {
    if (ids.length > 1) {
      conflicts.push({
        combo: sig.split('::').slice(1).join('::'),
        actionIds: ids,
      });
    }
  }
  return conflicts;
}

/**
 * Canonicalize a KeyboardEvent into the combo string we store in config.
 * Example: Cmd+Shift+K, Ctrl+F, Alt+ArrowRight, ?, Space, j.
 */
export function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey) parts.push('Cmd');
  if (e.ctrlKey && !e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey && e.key.length !== 1) parts.push('Shift');
  const key =
    e.key === ' '
      ? 'Space'
      : e.key.length === 1
        ? e.key
        : e.key.charAt(0).toUpperCase() + e.key.slice(1);
  parts.push(key);
  return parts.join('+');
}
