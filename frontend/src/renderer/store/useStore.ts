import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { createAnnotationSlice } from './slices/annotationSlice';
import { createClaudeConfigSlice } from './slices/claudeConfigSlice';
import { createComparisonTabSlice } from './slices/comparisonTabSlice';
import { createConfigSlice } from './slices/configSlice';
import { createConnectionSlice } from './slices/connectionSlice';
import { createContextSlice } from './slices/contextSlice';
import { createConversationSlice } from './slices/conversation';
import { createNotificationSlice } from './slices/notificationSlice';
import { createPaneSlice } from './slices/paneSlice';
import { createProjectContextSlice } from './slices/projectContextSlice';
import { createProjectSlice } from './slices/projectSlice';
import { createReplaySlice } from './slices/replaySlice';
import { createRepositorySlice } from './slices/repositorySlice';
import { createSessionDetailSlice } from './slices/sessionDetailSlice';
import { createSessionSlice } from './slices/sessionSlice';
import { createSnapshotSlice } from './slices/snapshotSlice';
import { createSubagentSlice } from './slices/subagentSlice';
import { createTabSlice } from './slices/tabSlice';
import { createTabUISlice } from './slices/tabUISlice';
import { createUISlice } from './slices/uiSlice';
import { createUpdateSlice } from './slices/updateSlice';

import type { ActivityView } from './slices/uiSlice';
import type { AppState } from './types';
import type { PaneLayout } from '@renderer/types/panes';
import type { Tab } from '@renderer/types/tabs';

interface PersistedState {
  paneLayout: PaneLayout;
  sidebarCollapsed: boolean;
  activeActivity: ActivityView;
  viewMode: 'flat' | 'grouped';
}

const PERSIST_VERSION = 1;

function sanitizeTabForPersist(tab: Tab): Tab {
  // Destructuring to strip transient fields; explicit names make intent clear.
  // oxlint-disable-next-line eslint/no-unused-vars, sonarjs/no-unused-vars, sonarjs/no-dead-store
  const { pendingNavigation, lastConsumedNavigationId, savedScrollTop, ...rest } = tab;
  return rest;
}

export const useStore = create<AppState>()(
  persist(
    (...args) => ({
      ...createProjectSlice(...args),
      ...createRepositorySlice(...args),
      ...createSessionSlice(...args),
      ...createSessionDetailSlice(...args),
      ...createSubagentSlice(...args),
      ...createConversationSlice(...args),
      ...createTabSlice(...args),
      ...createTabUISlice(...args),
      ...createPaneSlice(...args),
      ...createProjectContextSlice(...args),
      ...createUISlice(...args),
      ...createNotificationSlice(...args),
      ...createConfigSlice(...args),
      ...createClaudeConfigSlice(...args),
      ...createConnectionSlice(...args),
      ...createContextSlice(...args),
      ...createUpdateSlice(...args),
      ...createAnnotationSlice(...args),
      ...createReplaySlice(...args),
      ...createComparisonTabSlice(...args),
      ...createSnapshotSlice(...args),
    }),
    {
      name: 'claude-devtools-store',
      version: PERSIST_VERSION,
      partialize: (state): PersistedState => ({
        paneLayout: {
          ...state.paneLayout,
          panes: state.paneLayout.panes.map((pane) => ({
            ...pane,
            tabs: pane.tabs.map(sanitizeTabForPersist),
          })),
        },
        sidebarCollapsed: state.sidebarCollapsed,
        activeActivity: state.activeActivity,
        viewMode: state.viewMode,
      }),
      merge: (persisted, current) => {
        const saved = persisted as PersistedState | undefined;
        if (!saved) return current;
        return {
          ...current,
          paneLayout: saved.paneLayout,
          sidebarCollapsed: saved.sidebarCollapsed,
          activeActivity: saved.activeActivity,
          viewMode: saved.viewMode,
        };
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // After hydration, sync root-level tab state from the restored pane layout
        // and load session data for the active tab.
        rehydratePersistedTabs(state);
      },
    }
  )
);

function rehydratePersistedTabs(state: AppState): void {
  const { paneLayout } = state;
  const focusedPane = paneLayout.panes.find((p) => p.id === paneLayout.focusedPaneId);
  if (!focusedPane) return;

  useStore.setState({
    openTabs: focusedPane.tabs,
    activeTabId: focusedPane.activeTabId,
    selectedTabIds: focusedPane.selectedTabIds,
  });

  const activeTab = focusedPane.tabs.find((t) => t.id === focusedPane.activeTabId);
  if (activeTab?.type === 'session' && activeTab.projectId && activeTab.sessionId) {
    void useStore
      .getState()
      .fetchSessionDetail(activeTab.projectId, activeTab.sessionId, activeTab.id);
  }
}
