import { JSX, useEffect } from 'react';
import { Button } from '@renderer/components/ui/button';
import { ErrorState } from '@renderer/components/common/ErrorState';
import { LoadingState } from '@renderer/components/common/LoadingState';
import { useUIMode } from '@renderer/hooks/useUIMode';
import { useStore } from '@renderer/store';
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
      <div className="bg-background flex min-w-0 flex-1 flex-col overflow-hidden">
        <ErrorState
          message="Failed to load session"
          detail={mode === 'simple' ? undefined : sessionDetailError}
          retryLabel="Retry"
          onRetry={() => {
            if (tab.projectId && tab.sessionId) {
              void fetchSessionDetail(tab.projectId, tab.sessionId, tab.id);
            }
          }}
        />
        <div className="flex justify-center pb-8">
          <Button type="button" variant="ghost" onClick={() => closeTab(tab.id)}>
            Close tab
          </Button>
        </div>
      </div>
    );
  }

  if (sessionDetailLoading) {
    return (
      <div className="bg-background flex min-w-0 flex-1 flex-col overflow-hidden">
        <LoadingState label="Loading session" rows={6} />
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
