import { beforeEach, describe, expect, test } from 'bun:test';

import { useStore } from './index';

import type { AppConfig, UIMode } from '@shared/types';

function configWithMode(uiMode: UIMode): AppConfig {
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

function openSession(label: string): void {
  useStore.getState().openTab({
    type: 'session',
    projectId: 'project',
    sessionId: label,
    label,
  });
}

describe('mode-aware shell store behavior', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
    useStore.setState({ fetchSessionDetail: async () => undefined });
  });

  test('routes non-empty shell queries without changing conversation search state', () => {
    useStore.setState({ appConfig: configWithMode('simple'), searchQuery: 'inside-session' });
    useStore.getState().setActiveActivity('projects');
    useStore.getState().setShellSearchQuery('global query');

    expect(useStore.getState().activeActivity).toBe('search');
    expect(useStore.getState().shellSearchQuery).toBe('global query');
    expect(useStore.getState().searchQuery).toBe('inside-session');

    useStore.getState().setShellSearchQuery('');
    expect(useStore.getState().activeActivity).toBe('projects');
    expect(useStore.getState().shellSearchQuery).toBe('');
    expect(useStore.getState().searchQuery).toBe('inside-session');
  });

  test('blocks both pane-creation actions in Simple mode', () => {
    useStore.setState({ appConfig: configWithMode('simple') });
    openSession('one');
    openSession('two');
    const before = structuredClone(useStore.getState().paneLayout);
    const pane = before.panes[0];
    const tabId = pane.activeTabId;
    if (!tabId) throw new Error('Expected active test tab');

    useStore.getState().splitPane(pane.id, tabId, 'right');
    expect(useStore.getState().paneLayout).toEqual(before);

    useStore.getState().moveTabToNewPane(tabId, pane.id, pane.id, 'right');
    expect(useStore.getState().paneLayout).toEqual(before);
  });

  test('preserves pane topology across Nerd to Simple to Nerd activity routing', () => {
    useStore.setState({ appConfig: configWithMode('nerd') });
    openSession('one');
    openSession('two');
    const sourcePane = useStore.getState().paneLayout.panes[0];
    const activeTabId = sourcePane.activeTabId;
    if (!activeTabId) throw new Error('Expected active test tab');
    useStore.getState().splitPane(sourcePane.id, activeTabId, 'right');
    const nerdLayout = structuredClone(useStore.getState().paneLayout);

    useStore.setState({ appConfig: configWithMode('simple') });
    useStore.getState().setActiveActivity('projects');
    expect(useStore.getState().isActivityViewActive).toBeTrue();
    expect(useStore.getState().paneLayout).toEqual(nerdLayout);

    const focusedTabId = useStore.getState().paneLayout.panes.find(
      (pane) => pane.id === useStore.getState().paneLayout.focusedPaneId
    )?.activeTabId;
    if (!focusedTabId) throw new Error('Expected focused test tab');
    useStore.getState().setActiveTab(focusedTabId);
    expect(useStore.getState().isActivityViewActive).toBeFalse();
    expect(useStore.getState().paneLayout).toEqual(nerdLayout);

    useStore.setState({ appConfig: configWithMode('nerd') });
    expect(useStore.getState().paneLayout).toEqual(nerdLayout);
  });
});
