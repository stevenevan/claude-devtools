import { JSX, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { api } from './api';
import { ConfirmDialog } from './components/common/ConfirmDialog';
import { ContextSwitchOverlay } from './components/common/ContextSwitchOverlay';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { ErrorState } from './components/common/ErrorState';
import { HelpPanel } from './components/common/HelpPanel';
import { ModeAnnouncer } from './components/common/ModeAnnouncer';
import { PaneAnnouncer } from './components/common/PaneAnnouncer';
import { ShortcutCheatSheet } from './components/common/ShortcutCheatSheet';
import { SkeletonShell } from './components/common/SkeletonShell';
import { TabbedLayout } from './components/layout/TabbedLayout';
import { TooltipProvider } from './components/ui/tooltip';
import { useTheme } from './hooks/useTheme';
import { initializeNotificationListeners, useStore } from './store';

export const App = (): JSX.Element => {
  useTheme();

  const { shortcutCheatSheetOpen, toggleShortcutCheatSheet, helpPanelOpen, setHelpPanelOpen } =
    useStore(
      useShallow((s) => ({
        shortcutCheatSheetOpen: s.shortcutCheatSheetOpen,
        toggleShortcutCheatSheet: s.toggleShortcutCheatSheet,
        helpPanelOpen: s.helpPanelOpen,
        setHelpPanelOpen: s.setHelpPanelOpen,
      }))
    );

  const configStatus = useStore((s) => s.configStatus);
  const configError = useStore((s) => s.configError);

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

  if (configStatus !== 'ready') {
    return (
      <ErrorBoundary>
        <TooltipProvider>
          <ModeAnnouncer />
          {configStatus === 'error' ? (
            <ErrorState
              message="Couldn't load your settings."
              detail={configError ?? undefined}
              retryLabel="Try again"
              onRetry={() => void useStore.getState().fetchConfig()}
            />
          ) : (
            <SkeletonShell />
          )}
        </TooltipProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <TooltipProvider>
        <ModeAnnouncer />
        <PaneAnnouncer />
        <ContextSwitchOverlay />
        <TabbedLayout />
        <ConfirmDialog />
        <ShortcutCheatSheet open={shortcutCheatSheetOpen} onClose={toggleShortcutCheatSheet} />
        <HelpPanel open={helpPanelOpen} onClose={() => setHelpPanelOpen(false)} />
      </TooltipProvider>
    </ErrorBoundary>
  );
};
