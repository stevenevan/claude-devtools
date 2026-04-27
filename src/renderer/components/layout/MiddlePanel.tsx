import React from 'react';

import { useStore } from '@renderer/store';
import { useShallow } from 'zustand/react/shallow';

import { ChatHistory } from '../chat/ChatHistory';
import { SessionSummaryBar } from '../chat/SessionSummaryBar';
import { TeamTreeView } from '../chat/TeamTreeView';
import { ToolFlameGraph } from '../chat/ToolFlameGraph';
import { SearchBar } from '../search/SearchBar';

interface MiddlePanelProps {
  /** Tab ID for per-tab state isolation (scroll position, etc.) */
  tabId?: string;
}

export const MiddlePanel: React.FC<MiddlePanelProps> = ({ tabId }) => {
  const { flameGraphVisible, teamTreeVisible, chunks, processes } = useStore(
    useShallow((s) => {
      const td = tabId ? s.tabSessionData[tabId] : null;
      const detail = td?.sessionDetail ?? s.sessionDetail;
      return {
        flameGraphVisible: s.flameGraphVisible,
        teamTreeVisible: s.teamTreeVisible,
        chunks: detail?.chunks ?? [],
        processes: detail?.processes ?? [],
      };
    })
  );

  return (
    <div className="relative flex h-full flex-col">
      <SearchBar tabId={tabId} />
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
      <ChatHistory tabId={tabId} />
    </div>
  );
};
