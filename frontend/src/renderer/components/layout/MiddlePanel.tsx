import { FC } from 'react';

import { useUIMode } from '@renderer/hooks/useUIMode';
import { useStore } from '@renderer/store';
import { useShallow } from 'zustand/react/shallow';

import { ChatHistory } from '../chat/ChatHistory';
import { FileGraphView } from '../chat/FileGraphView';
import { SessionSummaryBar } from '../chat/SessionSummaryBar';
import { TeamTreeView } from '../chat/TeamTreeView';
import { ToolFlameGraph } from '../chat/ToolFlameGraph';

interface MiddlePanelProps {
  tabId?: string;
}

const EMPTY_ARRAY: never[] = [];

export const MiddlePanel: FC<MiddlePanelProps> = ({ tabId }) => {
  const mode = useUIMode();
  const {
    flameGraphVisible,
    teamTreeVisible,
    fileGraphVisible,
    chunks,
    processes,
    sessionProjectId,
    sessionId,
  } = useStore(
    useShallow((s) => {
      const td = tabId ? s.tabSessionData[tabId] : null;
      const detail = td?.sessionDetail ?? s.sessionDetail;
      return {
        flameGraphVisible: s.flameGraphVisible,
        teamTreeVisible: s.teamTreeVisible,
        fileGraphVisible: s.fileGraphVisible,
        chunks: detail?.chunks ?? EMPTY_ARRAY,
        processes: detail?.processes ?? EMPTY_ARRAY,
        sessionProjectId: detail?.session?.projectId ?? null,
        sessionId: detail?.session?.id ?? null,
      };
    })
  );

  return (
    <div className="relative flex h-full flex-col">
      {mode === 'nerd' && (
        <>
          <SessionSummaryBar tabId={tabId} />
          {flameGraphVisible && chunks.length > 0 && (
            <div className="border-border/50 shrink-0 border-b px-3 py-2">
              <ToolFlameGraph chunks={chunks} />
            </div>
          )}
          {teamTreeVisible && processes.length > 0 && (
            <div className="border-border/50 shrink-0 border-b px-3 py-2">
              <TeamTreeView processes={processes} />
            </div>
          )}
          {fileGraphVisible && sessionProjectId && sessionId && (
            <div className="border-border/50 shrink-0 border-b px-3 py-2">
              <FileGraphView projectId={sessionProjectId} sessionId={sessionId} />
            </div>
          )}
        </>
      )}
      <ChatHistory tabId={tabId} />
    </div>
  );
};
