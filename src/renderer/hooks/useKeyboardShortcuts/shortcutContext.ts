import type { useStore } from '../../store';

type StoreState = ReturnType<typeof useStore.getState>;

/**
 * The slice of store state/actions the keyboard handler reads from the
 * `useShallow` selector. Derived from the store so field types stay in sync.
 * (Values read ad-hoc via `useStore.getState()` inside the handler are not
 * part of this context.)
 */
export type ShortcutContext = Pick<
  StoreState,
  | 'openTabs'
  | 'activeTabId'
  | 'selectedTabIds'
  | 'openDashboard'
  | 'closeTab'
  | 'closeAllTabs'
  | 'closeTabs'
  | 'setActiveTab'
  | 'showSearch'
  | 'getActiveTab'
  | 'selectedProjectId'
  | 'selectedSessionId'
  | 'refreshSessionInPlace'
  | 'fetchSessions'
  | 'openCommandPalette'
  | 'openSettingsTab'
  | 'toggleSidebar'
  | 'setActiveActivity'
  | 'paneLayout'
  | 'focusPane'
  | 'splitPane'
  | 'closePane'
  | 'availableContexts'
  | 'activeContextId'
  | 'switchContext'
  | 'isContextSwitching'
>;
