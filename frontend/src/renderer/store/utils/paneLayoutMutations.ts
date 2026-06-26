import { findPaneByTabId, syncFocusedPaneState, updatePane } from './paneHelpers';

import type { PaneLayout } from '@renderer/types/panes';
import type { Tab } from '@renderer/types/tabs';

export function syncFromLayout(layout: PaneLayout): Record<string, unknown> {
  const synced = syncFocusedPaneState(layout);
  return {
    paneLayout: layout,
    openTabs: synced.openTabs,
    activeTabId: synced.activeTabId,
    selectedTabIds: synced.selectedTabIds,
  };
}

export function updateTabInLayout(
  layout: PaneLayout,
  tabId: string,
  updater: (tab: Tab) => Tab
): PaneLayout {
  const pane = findPaneByTabId(layout, tabId);
  if (!pane) return layout;
  return updatePane(layout, {
    ...pane,
    tabs: pane.tabs.map((t) => (t.id === tabId ? updater(t) : t)),
  });
}
