import React, { useEffect } from 'react';

import { api } from './api';
import { ConfirmDialog } from './components/common/ConfirmDialog';
import { ContextSwitchOverlay } from './components/common/ContextSwitchOverlay';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { ShortcutCheatSheet } from './components/common/ShortcutCheatSheet';
import { TabbedLayout } from './components/layout/TabbedLayout';
import { TooltipProvider } from './components/ui/tooltip';
import { useTheme } from './hooks/useTheme';
import { initializeNotificationListeners, useStore } from './store';

export const App = (): React.JSX.Element => {
  // Initialize theme on app load
  useTheme();

  const { shortcutCheatSheetOpen, toggleShortcutCheatSheet } = useStore((s) => ({
    shortcutCheatSheetOpen: s.shortcutCheatSheetOpen,
    toggleShortcutCheatSheet: s.toggleShortcutCheatSheet,
  }));

  // Dismiss splash screen once React is ready
  useEffect(() => {
    const splash = document.getElementById('splash');
    if (splash) {
      splash.style.opacity = '0';
      setTimeout(() => splash.remove(), 300);
    }
  }, []);

  // Initialize context system (before notification listeners)
  useEffect(() => {
    void useStore.getState().initializeContextSystem();
  }, []);

  // Refresh available contexts when SSH connection state changes
  useEffect(() => {
    if (!api.ssh?.onStatus) return;
    const cleanup = api.ssh.onStatus(() => {
      void useStore.getState().fetchAvailableContexts();
    });
    return cleanup;
  }, []);

  // Initialize IPC event listeners (notifications, file changes)
  useEffect(() => {
    const cleanup = initializeNotificationListeners();
    return cleanup;
  }, []);

  return (
    <ErrorBoundary>
      <TooltipProvider>
        <ContextSwitchOverlay />
        <TabbedLayout />
        <ConfirmDialog />
        <ShortcutCheatSheet
          open={shortcutCheatSheetOpen}
          onClose={toggleShortcutCheatSheet}
        />
      </TooltipProvider>
    </ErrorBoundary>
  );
};
