import { describe, expect, test } from 'bun:test';

import {
  filterSettingsSearchItems,
  getSettingsSearchTarget,
  SETTINGS_SEARCH_ITEMS,
} from './settingsSearchRegistry';

describe('settings search', () => {
  test('filters labels and section names case-insensitively', () => {
    expect(filterSettingsSearchItems('THEME').map((item) => item.id)).toEqual([
      'theme',
      'code-block-theme',
      'theme-editor',
    ]);
    expect(filterSettingsSearchItems('advanced').map((item) => item.id)).toEqual([
      'configuration',
      'debug',
      'about',
    ]);
  });

  test('returns no targets for an empty query and preserves stable targets', () => {
    expect(filterSettingsSearchItems('   ')).toEqual([]);

    const item = SETTINGS_SEARCH_ITEMS.find((candidate) => candidate.id === 'launch-at-login');
    expect(item).toBeDefined();
    expect(getSettingsSearchTarget(item!)).toEqual({
      section: 'general',
      anchorId: 'settings-launch-at-login',
    });

    const codexItem = SETTINGS_SEARCH_ITEMS.find((candidate) => candidate.id === 'codex-settings');
    expect(codexItem).toBeDefined();
    expect(getSettingsSearchTarget(codexItem!)).toEqual({
      section: 'claudeCode',
      anchorId: 'settings-codex-settings-heading',
    });
  });
});
