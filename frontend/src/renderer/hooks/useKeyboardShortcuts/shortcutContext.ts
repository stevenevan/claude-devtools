import type { useStore } from '../../store';

type StoreState = ReturnType<typeof useStore.getState>;

// Values read ad-hoc via `useStore.getState()` inside the handler are not part of this context.
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
