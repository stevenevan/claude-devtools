/**
 * SessionTabContent - Renders session content with loading/error states.
 * Each session tab has its own instance to preserve state.
 */

import { useEffect } from 'react';

import { useStore } from '@renderer/store';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { MiddlePanel } from './MiddlePanel';

import type { Tab } from '@renderer/types/tabs';

export const SessionTabContent = ({
  tab,
  isActive,
}: Readonly<{ tab: Tab; isActive: boolean }>): React.JSX.Element => {
  const { fetchSessionDetail, closeTab, initTabUIState } = useStore(
    useShallow((s) => ({
      fetchSessionDetail: s.fetchSessionDetail,
      closeTab: s.closeTab,
      initTabUIState: s.initTabUIState,
    }))
  );

  // Read loading/error from per-tab data, falling back to global state
  const { sessionDetailError, sessionDetailLoading } = useStore(
    useShallow((s) => {
      const td = s.tabSessionData[tab.id];
      return {
        sessionDetailError: td?.sessionDetailError ?? s.sessionDetailError,
        sessionDetailLoading: td?.sessionDetailLoading ?? s.sessionDetailLoading,
      };
    })
  );

  // Initialize per-tab UI state when this tab is first mounted
  useEffect(() => {
    initTabUIState(tab.id);
  }, [tab.id, initTabUIState]);

  // Only show loading/error states when this tab is active
  if (!isActive) {
    return (
      <div className="bg-background flex min-w-0 flex-1 flex-col overflow-hidden">
        <MiddlePanel tabId={tab.id} />
      </div>
    );
  }

  if (sessionDetailError) {
    return (
      <div className="bg-background flex flex-1 items-center justify-center">
        <div className="p-8 text-center">
          <AlertCircle className="mx-auto mb-4 size-12 text-red-500/70" />
          <h3 className="text-foreground mb-2 text-lg font-medium">Failed to load session</h3>
          <p className="text-foreground-secondary mb-4 max-w-md text-sm">
            {sessionDetailError}
          </p>
          <div className="flex justify-center gap-3">
            <button
              onClick={() => {
                if (tab.projectId && tab.sessionId) {
                  void fetchSessionDetail(tab.projectId, tab.sessionId, tab.id);
                }
              }}
              className="border-border bg-background hover:bg-card flex items-center gap-2 rounded-md border px-4 py-2 text-sm transition-colors"
            >
              <RefreshCw className="size-4" />
              Retry
            </button>
            <button
              onClick={() => closeTab(tab.id)}
              className="text-foreground-secondary hover:text-foreground px-4 py-2 text-sm transition-colors"
            >
              Close tab
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (sessionDetailLoading) {
    return (
      <div className="bg-background flex flex-1 items-center justify-center">
        <div className="text-center">
          <div className="border-muted-foreground border-t-foreground mx-auto mb-4 size-8 animate-spin rounded-full border-2" />
          <p className="text-foreground-secondary text-sm">Loading session...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background flex min-w-0 flex-1 flex-col overflow-hidden">
      <MiddlePanel tabId={tab.id} />
    </div>
  );
};
