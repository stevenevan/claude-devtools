import { findPaneByTabId, syncFocusedPaneState, updatePane } from './paneHelpers';

import type { PaneLayout } from '@renderer/types/panes';
import type { Tab } from '@renderer/types/tabs';

/**
 * Sync root-level state (openTabs, activeTabId, selectedTabIds) from the
 * focused pane and return the patch to splat into the store.
 */
export function syncFromLayout(layout: PaneLayout): Record<string, unknown> {
  const synced = syncFocusedPaneState(layout);
  return {
    paneLayout: layout,
    openTabs: synced.openTabs,
    activeTabId: synced.activeTabId,
    selectedTabIds: synced.selectedTabIds,
  };
}

/**
 * Update a tab in whichever pane contains it, returning the new layout.
 */
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
