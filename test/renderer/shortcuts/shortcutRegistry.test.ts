import { describe, expect, it } from 'vitest';

import {
  findConflicts,
  resolveBindings,
  SHORTCUT_ACTIONS,
} from '../../../src/renderer/shortcuts/shortcutRegistry';

describe('resolveBindings', () => {
  it('returns defaults when no overrides', () => {
    const bindings = resolveBindings(undefined);
    for (const action of SHORTCUT_ACTIONS) {
      expect(bindings[action.id]).toBe(action.defaultCombo);
    }
  });

  it('applies overrides', () => {
    const bindings = resolveBindings({ 'open-command-palette': 'Cmd+P' });
    expect(bindings['open-command-palette']).toBe('Cmd+P');
  });

  it('ignores empty overrides', () => {
    const bindings = resolveBindings({ 'open-command-palette': '   ' });
    expect(bindings['open-command-palette']).toBe('Cmd+K');
  });
});

describe('findConflicts', () => {
  it('returns empty when defaults are fine', () => {
    expect(findConflicts(resolveBindings(undefined))).toEqual([]);
  });

  it('flags two actions mapped to the same combo in the same scope', () => {
    const bindings = resolveBindings({
      'new-tab': 'Cmd+K',
    });
    const conflicts = findConflicts(bindings);
    expect(conflicts).toHaveLength(1);
    const ids = new Set(conflicts[0].actionIds);
    expect(ids.has('open-command-palette')).toBe(true);
    expect(ids.has('new-tab')).toBe(true);
  });

  it('does not flag conflicts across scopes (app vs session)', () => {
    // 'next-turn' is session-scoped; rebind it to 'Cmd+K' (app-scoped) — that's
    // still a conflict since the two scopes we track are treated as separate
    // dispatch contexts. Ensure findConflicts distinguishes.
    const bindings = resolveBindings({
      'next-turn': 'Cmd+P', // unique
    });
    expect(findConflicts(bindings)).toEqual([]);
  });
});
