import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { useStore } from '../../store';
import { handleShortcutKeyDown } from './handleShortcutKeyDown';

import type { AppConfig } from '@shared/types';
import type { ShortcutContext } from './shortcutContext';

function configWithMode(uiMode: 'simple' | 'nerd'): AppConfig {
  return {
    notifications: {
      enabled: true,
      soundEnabled: true,
      ignoredRegex: [],
      ignoredRepositories: [],
      snoozedUntil: null,
      snoozeMinutes: 30,
      includeSubagentErrors: true,
      triggers: [],
      retentionDays: 30,
      maxCount: 500,
    },
    general: {
      launchAtLogin: false,
      theme: 'system',
      defaultTab: 'dashboard',
      claudeRootPath: null,
      autoExpandAIGroups: false,
      useNativeTitleBar: false,
      uiMode,
    },
    display: {
      codeBlockTheme: 'default',
      showLineNumbers: true,
      wordWrap: true,
    },
    sessions: {
      pinnedSessions: {},
      hiddenSessions: {},
    },
  };
}

interface RecordedCall {
  name: string;
  args: unknown[];
}

function makeCtx(): { ctx: ShortcutContext; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push({ name, args });
    };
  const ctx = {
    openTabs: [{ id: 'tab-1' }, { id: 'tab-2' }],
    activeTabId: 'tab-1',
    selectedTabIds: [],
    openDashboard: record('openDashboard'),
    closeTab: record('closeTab'),
    closeAllTabs: record('closeAllTabs'),
    closeTabs: record('closeTabs'),
    setActiveTab: record('setActiveTab'),
    showSearch: record('showSearch'),
    getActiveTab: () => ({ type: 'session' }),
    selectedProjectId: null,
    selectedSessionId: null,
    refreshSessionInPlace: record('refreshSessionInPlace'),
    fetchSessions: record('fetchSessions'),
    openCommandPalette: record('openCommandPalette'),
    openSettingsTab: record('openSettingsTab'),
    toggleSidebar: record('toggleSidebar'),
    setActiveActivity: record('setActiveActivity'),
    paneLayout: {
      panes: [{ id: 'pane-1' }, { id: 'pane-2' }],
      focusedPaneId: 'pane-1',
    },
    focusPane: record('focusPane'),
    splitPane: record('splitPane'),
    closePane: record('closePane'),
    moveTabToNewPane: record('moveTabToNewPane'),
    searchVisible: false,
    nextSearchResult: record('nextSearchResult'),
    previousSearchResult: record('previousSearchResult'),
  } as unknown as ShortcutContext;
  return { ctx, calls };
}

function keyEvent(init: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): { event: KeyboardEvent; prevented: () => boolean } {
  let stopped = false;
  const event = {
    key: init.key,
    metaKey: init.metaKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    shiftKey: init.shiftKey ?? false,
    altKey: init.altKey ?? false,
    target: { tagName: 'BODY' },
    preventDefault: () => {
      stopped = true;
    },
  } as unknown as KeyboardEvent;
  return { event, prevented: () => stopped };
}

function called(calls: RecordedCall[], name: string): RecordedCall[] {
  return calls.filter((call) => call.name === name);
}

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  useStore.setState({ appConfig: configWithMode('nerd') });
});

afterEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  delete (globalThis as { document?: unknown }).document;
});

describe('keyboard-first walkthrough', () => {
  test('opens the command palette and shares one global query with the shell field', () => {
    const { ctx, calls } = makeCtx();
    const open = keyEvent({ key: 'k', metaKey: true });
    handleShortcutKeyDown(open.event, ctx);
    expect(open.prevented()).toBeTrue();
    expect(called(calls, 'openCommandPalette')).toHaveLength(1);

    useStore.getState().setShellSearchQuery('env');
    expect(useStore.getState().shellSearchQuery).toBe('env');
  });

  test('does not reroute the background activity while the palette is open', () => {
    useStore.setState({ activeActivity: 'projects', previousActivity: 'projects' });
    useStore.setState({ commandPaletteOpen: true });
    useStore.getState().setShellSearchQuery('shared query');
    expect(useStore.getState().shellSearchQuery).toBe('shared query');
    expect(useStore.getState().activeActivity).toBe('projects');

    useStore.setState({ commandPaletteOpen: false });
    useStore.getState().setShellSearchQuery('shell query');
    expect(useStore.getState().activeActivity).toBe('search');
  });

  test('finds in session then steps through matches with Cmd+G', () => {
    const { ctx, calls } = makeCtx();
    handleShortcutKeyDown(keyEvent({ key: 'f', metaKey: true }).event, ctx);
    expect(called(calls, 'showSearch')).toHaveLength(1);

    const withoutFind = keyEvent({ key: 'g', metaKey: true });
    handleShortcutKeyDown(withoutFind.event, ctx);
    expect(called(calls, 'nextSearchResult')).toHaveLength(0);

    const withFind = makeCtx();
    withFind.ctx.searchVisible = true;
    handleShortcutKeyDown(keyEvent({ key: 'g', metaKey: true }).event, withFind.ctx);
    expect(called(withFind.calls, 'nextSearchResult')).toHaveLength(1);
    handleShortcutKeyDown(
      keyEvent({ key: 'g', metaKey: true, shiftKey: true }).event,
      withFind.ctx
    );
    expect(called(withFind.calls, 'previousSearchResult')).toHaveLength(1);
  });

  test('moves the active tab to a new pane without hijacking plain tab navigation', () => {
    const { ctx, calls } = makeCtx();
    const move = keyEvent({ key: 'ArrowRight', metaKey: true, altKey: true, shiftKey: true });
    handleShortcutKeyDown(move.event, ctx);
    expect(move.prevented()).toBeTrue();
    expect(called(calls, 'moveTabToNewPane')).toEqual([
      { name: 'moveTabToNewPane', args: ['tab-1', 'pane-1', 'pane-1', 'right'] },
    ]);

    const { ctx: navCtx, calls: navCalls } = makeCtx();
    handleShortcutKeyDown(
      keyEvent({ key: 'ArrowRight', metaKey: true, altKey: true }).event,
      navCtx
    );
    expect(called(navCalls, 'moveTabToNewPane')).toHaveLength(0);
    expect(called(navCalls, 'setActiveTab')).toHaveLength(1);
  });

  test('blocks pane moves in Simple mode', () => {
    useStore.setState({ appConfig: configWithMode('simple') });
    const { ctx, calls } = makeCtx();
    handleShortcutKeyDown(
      keyEvent({ key: 'ArrowRight', metaKey: true, altKey: true, shiftKey: true }).event,
      ctx
    );
    expect(called(calls, 'moveTabToNewPane')).toHaveLength(0);
  });

  test('closes a pane and focuses the shell search field by keyboard', () => {
    const { ctx, calls } = makeCtx();
    handleShortcutKeyDown(
      keyEvent({ key: 'w', metaKey: true, altKey: true }).event,
      ctx
    );
    expect(called(calls, 'closePane')).toEqual([{ name: 'closePane', args: ['pane-1'] }]);

    let focused = false;
    (globalThis as { document?: unknown }).document = {
      getElementById: (id: string) =>
        id === 'shell-search-input' ? { focus: () => { focused = true; } } : null,
    };
    handleShortcutKeyDown(keyEvent({ key: 'f', metaKey: true, shiftKey: true }).event, ctx);
    expect(focused).toBeTrue();
  });
});
