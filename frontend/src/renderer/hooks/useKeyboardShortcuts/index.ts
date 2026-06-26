/**
 * useKeyboardShortcuts - Global keyboard shortcut handler
 * Handles app-wide keyboard shortcuts for tab management, navigation, and pane management.
 *
 * Pane-scoped: Tab cycling (Ctrl+Tab, Cmd+1-9, Cmd+Shift+[/]) operates within the focused pane.
 * Pane shortcuts: Cmd+Option+1-4 (focus pane), Cmd+\ (split right), Cmd+Option+W (close pane).
 */

import { useEffect } from 'react';

import { useShallow } from 'zustand/react/shallow';

import { useStore } from '../../store';
import { handleShortcutKeyDown } from './handleShortcutKeyDown';

export function useKeyboardShortcuts(): void {
  const ctx = useStore(
    useShallow((s) => ({
      openTabs: s.openTabs,
      activeTabId: s.activeTabId,
      selectedTabIds: s.selectedTabIds,
      openDashboard: s.openDashboard,
      closeTab: s.closeTab,
      closeAllTabs: s.closeAllTabs,
      closeTabs: s.closeTabs,
      setActiveTab: s.setActiveTab,
      showSearch: s.showSearch,
      getActiveTab: s.getActiveTab,
      selectedProjectId: s.selectedProjectId,
      selectedSessionId: s.selectedSessionId,
      refreshSessionInPlace: s.refreshSessionInPlace,
      fetchSessions: s.fetchSessions,
      openCommandPalette: s.openCommandPalette,
      openSettingsTab: s.openSettingsTab,
      toggleSidebar: s.toggleSidebar,
      setActiveActivity: s.setActiveActivity,
      paneLayout: s.paneLayout,
      focusPane: s.focusPane,
      splitPane: s.splitPane,
      closePane: s.closePane,
      availableContexts: s.availableContexts,
      activeContextId: s.activeContextId,
      switchContext: s.switchContext,
      isContextSwitching: s.isContextSwitching,
    }))
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      handleShortcutKeyDown(event, ctx);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [ctx]);
}
