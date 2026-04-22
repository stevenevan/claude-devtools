import React from 'react';

import { useStore } from '@renderer/store';
import { useShallow } from 'zustand/react/shallow';

import { ChatHistory } from '../chat/ChatHistory';
import { SessionSummaryBar } from '../chat/SessionSummaryBar';
import { ToolFlameGraph } from '../chat/ToolFlameGraph';
import { SearchBar } from '../search/SearchBar';

interface MiddlePanelProps {
  /** Tab ID for per-tab state isolation (scroll position, etc.) */
  tabId?: string;
}

export const MiddlePanel: React.FC<MiddlePanelProps> = ({ tabId }) => {
  const { flameGraphVisible, chunks } = useStore(
    useShallow((s) => {
      const td = tabId ? s.tabSessionData[tabId] : null;
      const detail = td?.sessionDetail ?? s.sessionDetail;
      return {
        flameGraphVisible: s.flameGraphVisible,
        chunks: detail?.chunks ?? [],
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
      <ChatHistory tabId={tabId} />
    </div>
  );
};
