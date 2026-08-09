import { describe, expect, test } from 'bun:test';

import { canUsePaneShortcuts } from './handleShortcutKeyDown';

describe('pane keyboard shortcuts', () => {
  test('blocks pane shortcuts in Simple mode', () => {
    expect(canUsePaneShortcuts('simple')).toBeFalse();
  });

  test('allows pane shortcuts in Nerd mode', () => {
    expect(canUsePaneShortcuts('nerd')).toBeTrue();
  });
});
