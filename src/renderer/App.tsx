import React, { useEffect } from 'react';

import { api } from './api';
import { ConfirmDialog } from './components/common/ConfirmDialog';
import { ContextSwitchOverlay } from './components/common/ContextSwitchOverlay';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { HelpPanel } from './components/common/HelpPanel';
import { ShortcutCheatSheet } from './components/common/ShortcutCheatSheet';
import { TabbedLayout } from './components/layout/TabbedLayout';
import { TooltipProvider } from './components/ui/tooltip';
import { useTheme } from './hooks/useTheme';
import { initializeNotificationListeners, useStore } from './store';
import { useShallow } from 'zustand/react/shallow';

export const App = (): React.JSX.Element => {
  useTheme();

  const {
    shortcutCheatSheetOpen,
    toggleShortcutCheatSheet,
    helpPanelOpen,
    setHelpPanelOpen,
  } = useStore(
    useShallow((s) => ({
      shortcutCheatSheetOpen: s.shortcutCheatSheetOpen,
      toggleShortcutCheatSheet: s.toggleShortcutCheatSheet,
      helpPanelOpen: s.helpPanelOpen,
      setHelpPanelOpen: s.setHelpPanelOpen,
    }))
  );

  // Dismiss splash screen once React is ready
  useEffect(() => {
    const splash = document.getElementById('splash');
    if (splash) {
      splash.style.opacity = '0';
      setTimeout(() => splash.remove(), 300);
    }
  }, []);

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
        <HelpPanel open={helpPanelOpen} onClose={() => setHelpPanelOpen(false)} />
      </TooltipProvider>
    </ErrorBoundary>
  );
};
