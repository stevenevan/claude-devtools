import { JSX, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { api } from './api';
import { ConfirmDialog } from './components/common/ConfirmDialog';
import { ContextSwitchOverlay } from './components/common/ContextSwitchOverlay';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { HelpPanel } from './components/common/HelpPanel';
import { ModeAnnouncer } from './components/common/ModeAnnouncer';
import { ShortcutCheatSheet } from './components/common/ShortcutCheatSheet';
import { SkeletonShell } from './components/common/SkeletonShell';
import { TabbedLayout } from './components/layout/TabbedLayout';
import { Button } from './components/ui/button';
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
            // Sprint 03 replaces this inline fallback with the shared ErrorState.
            <div className="flex h-screen w-screen items-center justify-center" role="alert">
              <div className="flex max-w-sm flex-col items-center gap-3 p-6 text-center">
                <p className="text-sm font-medium">Couldn&apos;t load your settings.</p>
                <p className="text-xs text-muted-foreground">
                  {configError ?? 'The configuration failed to load.'}
                </p>
                <Button
                  onClick={() => void useStore.getState().fetchConfig()}
                  aria-label="Retry loading settings"
                >
                  Try again
                </Button>
              </div>
            </div>
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
        <ContextSwitchOverlay />
        <TabbedLayout />
        <ConfirmDialog />
        <ShortcutCheatSheet open={shortcutCheatSheetOpen} onClose={toggleShortcutCheatSheet} />
        <HelpPanel open={helpPanelOpen} onClose={() => setHelpPanelOpen(false)} />
      </TooltipProvider>
    </ErrorBoundary>
  );
};
