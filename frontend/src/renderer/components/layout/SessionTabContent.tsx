import { JSX, useEffect } from 'react';
import { Button } from '@renderer/components/ui/button';
import { useUIMode } from '@renderer/hooks/useUIMode';
import { useStore } from '@renderer/store';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { SubagentDetailPanel } from '../chat/SubagentDetailPanel';

import { MiddlePanel } from './MiddlePanel';
import { SimpleSessionHeader } from './SimpleSessionHeader';

import type { Tab } from '@renderer/types/tabs';

export const SessionTabContent = ({
  tab,
  isActive,
}: Readonly<{ tab: Tab; isActive: boolean }>): JSX.Element => {
  const mode = useUIMode();
  const { fetchSessionDetail, closeTab, initTabUIState, setActiveActivity } = useStore(
    useShallow((s) => ({
      fetchSessionDetail: s.fetchSessionDetail,
      closeTab: s.closeTab,
      initTabUIState: s.initTabUIState,
      setActiveActivity: s.setActiveActivity,
    }))
  );

  // Read loading/error from per-tab data, falling back to global state
  const { sessionDetailError, sessionDetailLoading, session } = useStore(
    useShallow((s) => {
      const td = s.tabSessionData[tab.id];
      const sessionDetail = td?.sessionDetail ?? s.sessionDetail;
      const session = sessionDetail?.session;
      const matchingSession =
        session && session.id === tab.sessionId && session.projectId === tab.projectId ? session : null;
      return {
        sessionDetailError: td?.sessionDetailError ?? s.sessionDetailError,
        sessionDetailLoading: td?.sessionDetailLoading ?? s.sessionDetailLoading,
        session: matchingSession,
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
            {mode === 'simple' ? 'Try loading this conversation again.' : sessionDetailError}
          </p>
          <div className="flex justify-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (tab.projectId && tab.sessionId) {
                  void fetchSessionDetail(tab.projectId, tab.sessionId, tab.id);
                }
              }}
              className="gap-2"
            >
              <RefreshCw className="size-4" />
              Retry
            </Button>
            <Button type="button" variant="ghost" onClick={() => closeTab(tab.id)}>
              Close tab
            </Button>
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
    <div className="bg-background relative flex min-w-0 flex-1 flex-col overflow-hidden">
      {mode === 'simple' && session && (
        <SimpleSessionHeader session={session} onBack={() => setActiveActivity('projects')} />
      )}
      <MiddlePanel tabId={tab.id} />
      {mode === 'nerd' && <SubagentDetailPanel />}
    </div>
  );
};
