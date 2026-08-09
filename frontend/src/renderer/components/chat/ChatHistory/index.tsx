import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useChatHistoryScroll } from '@renderer/hooks/useChatHistoryScroll';
import { useTabNavigationController } from '@renderer/hooks/useTabNavigationController';
import { useUIMode } from '@renderer/hooks/useUIMode';
import { useTabUI } from '@renderer/hooks/useTabUI';
import { useTurnNavigationListener } from '@renderer/hooks/useTurnNavigationListener';
import { useVisibleAIGroup } from '@renderer/hooks/useVisibleAIGroup';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { countPendingTodos } from '@renderer/types/todos';

import { SearchBar } from '../../search/SearchBar';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronsDown, MessageSquare } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { LiveMetricsBar } from '../../common/LiveMetricsBar';
import { computeContextInjectionsForPhase } from '../chatHistoryDerivations';
import { ChatHistoryLoadingState } from '../ChatHistoryLoadingState';
import { ChatHistoryVirtualizer, getChatItemKey } from '../ChatHistoryVirtualizer';
import { ContextHeatmap } from '../ContextHeatmap';
import { ReplayControls } from '../ReplayControls';
import { useChatHistoryNavigation } from '../useChatHistoryNavigation';
import { useSearchMatchSync } from '../useSearchMatchSync';
import { createSimpleConversation } from '../simpleChat';

import { ChatHistorySidePanels } from './ChatHistorySidePanels';
import { ChatHistoryToolbar } from './ChatHistoryToolbar';
import { CONTEXT_PANEL_WIDTH_PX, waitForDoubleRaf } from './helpers';
import { useChatHistoryRefs } from './useChatHistoryRefs';

interface ChatHistoryProps {
  tabId?: string;
}

export const ChatHistory = ({ tabId }: ChatHistoryProps): JSX.Element => {
  const VIRTUALIZATION_THRESHOLD = 120;
  const ESTIMATED_CHAT_ITEM_HEIGHT = 260;
  const mode = useUIMode();
  const isSimple = mode === 'simple';

  const {
    isContextPanelVisible,
    setContextPanelVisible,
    savedScrollTop,
    saveScrollPosition,
    expandAIGroup,
    expandSubagentTrace,
    selectedContextPhase,
    setSelectedContextPhase,
  } = useTabUI();

  const [isTodoPanelVisible, setIsTodoPanelVisible] = useState(false);

  const {
    searchQuery,
    currentSearchIndex,
    searchMatches,
    openTabs,
    activeTabId,
    consumeTabNavigation,
    setSearchQuery,
    syncSearchMatchesWithRendered,
    selectSearchMatch,
    setTabVisibleAIGroup,
    contextHeatmapVisible,
    toggleContextHeatmap,
    replayMode,
    replayCursorIndex,
  } = useStore(
    useShallow((s) => ({
      searchQuery: s.searchQuery,
      currentSearchIndex: s.currentSearchIndex,
      searchMatches: s.searchMatches,
      openTabs: s.openTabs,
      activeTabId: s.activeTabId,
      consumeTabNavigation: s.consumeTabNavigation,
      setSearchQuery: s.setSearchQuery,
      syncSearchMatchesWithRendered: s.syncSearchMatchesWithRendered,
      selectSearchMatch: s.selectSearchMatch,
      setTabVisibleAIGroup: s.setTabVisibleAIGroup,
      contextHeatmapVisible: s.contextHeatmapVisible,
      toggleContextHeatmap: s.toggleContextHeatmap,
      replayMode: s.replayMode,
      replayCursorIndex: s.replayCursorIndex,
    }))
  );

  const tabData = useStore(
    useShallow((s) => {
      const td = tabId ? s.tabSessionData[tabId] : null;
      return {
        conversation: td?.conversation ?? s.conversation,
        conversationLoading: td?.conversationLoading ?? s.conversationLoading,
        sessionContextStats: td?.sessionContextStats ?? s.sessionContextStats,
        sessionPhaseInfo: td?.sessionPhaseInfo ?? s.sessionPhaseInfo,
        sessionDetail: td?.sessionDetail ?? s.sessionDetail,
        isStreaming: td?.isStreaming ?? false,
      };
    })
  );
  const {
    conversation,
    conversationLoading,
    sessionContextStats,
    sessionPhaseInfo,
    sessionDetail,
    isStreaming,
  } = tabData;

  const displayConversation = useMemo(
    () => (isSimple ? createSimpleConversation(conversation) : conversation),
    [conversation, isSimple]
  );

  const nerdConversation = isSimple ? null : conversation;
  const [isContextButtonHovered, setIsContextButtonHovered] = useState(false);

  const effectiveTabId = tabId ?? activeTabId;
  const isThisTabActive = effectiveTabId === activeTabId;

  const thisTab = effectiveTabId ? openTabs.find((t) => t.id === effectiveTabId) : null;
  const pendingNavigation = thisTab?.pendingNavigation;

  const { allContextInjections, lastAiGroupTotalTokens } = useMemo(
    () =>
      computeContextInjectionsForPhase({
        conversation: nerdConversation,
        contextStats: sessionContextStats,
        phaseInfo: sessionPhaseInfo,
        selectedPhase: selectedContextPhase,
      }),
    [sessionContextStats, nerdConversation, selectedContextPhase, sessionPhaseInfo]
  );

  const todoData = sessionDetail?.session?.todoData;
  const hasTodoData = todoData != null && Array.isArray(todoData) && todoData.length > 0;
  const todoPendingCount = hasTodoData ? countPendingTodos(todoData) : 0;

  const [isNavigationHighlight, setIsNavigationHighlight] = useState(false);
  const navigationHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const aiGroupRefs = useRef<Map<string, HTMLElement>>(new Map());
  const chatItemRefs = useRef<Map<string, HTMLElement>>(new Map());
  const toolItemRefs = useRef<Map<string, HTMLElement>>(new Map());

  const isSearchActive = searchQuery.trim().length > 0;
  const shouldVirtualize = (displayConversation?.items.length ?? 0) >= VIRTUALIZATION_THRESHOLD;

  // ponytail: useCallback required — passed to useTabNavigationController as setSearchQuery (in its dep array)
  const setSearchQueryForTab = useCallback(
    (query: string): void => {
      setSearchQuery(query, displayConversation);
    },
    [setSearchQuery, displayConversation]
  );

  const groupIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!displayConversation?.items) {
      return map;
    }
    displayConversation.items.forEach((item, index) => {
      map.set(item.group.id, index);
    });
    return map;
  }, [displayConversation]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? (displayConversation?.items.length ?? 0) : 0,
    getScrollElement: () => scrollContainerRef.current,
    getItemKey: (index) => {
      const item = displayConversation?.items[index];
      return item ? getChatItemKey(item) : index;
    },
    estimateSize: () => ESTIMATED_CHAT_ITEM_HEIGHT,
    overscan: 8,
    measureElement: (element) => element.getBoundingClientRect().height,
  });

  // ponytail: useCallback required — dep in useChatHistoryScroll, useTurnNavigationListener, useChatHistoryNavigation hooks
  const ensureGroupVisible = useCallback(
    async (groupId: string) => {
      if (!shouldVirtualize) {
        return;
      }
      const index = groupIndexMap.get(groupId);
      if (index === undefined) {
        return;
      }
      rowVirtualizer.scrollToIndex(index, { align: 'center' });
      await waitForDoubleRaf();
    },
    [groupIndexMap, rowVirtualizer, shouldVirtualize]
  );

  const STICKY_BUTTON_OFFSET = allContextInjections.length > 0 || hasTodoData ? 60 : 0;

  const {
    highlightedGroupId,
    setHighlightedGroupId,
    highlightToolUseId: controllerToolUseId,
    isSearchHighlight,
    highlightColor,
    shouldDisableAutoScroll,
  } = useTabNavigationController({
    isActiveTab: isThisTabActive && !isSimple,
    pendingNavigation,
    conversation: nerdConversation,
    conversationLoading,
    consumeTabNavigation,
    tabId: effectiveTabId ?? '',
    aiGroupRefs,
    chatItemRefs,
    toolItemRefs,
    expandAIGroup,
    expandSubagentTrace,
    scrollContainerRef,
    stickyOffset: STICKY_BUTTON_OFFSET,
    ensureGroupVisible,
    setSearchQuery: setSearchQueryForTab,
    selectSearchMatch,
  });

  const [contextNavToolUseId, setContextNavToolUseId] = useState<string | null>(null);
  const effectiveHighlightToolUseId = controllerToolUseId ?? contextNavToolUseId ?? undefined;
  const effectiveHighlightColor = contextNavToolUseId ? ('blue' as const) : highlightColor;

  useEffect(() => {
    if (!isThisTabActive || !searchQuery.trim()) {
      return;
    }
    setSearchQuery(searchQuery, displayConversation);
  }, [isThisTabActive, searchQuery, displayConversation, setSearchQuery]);

  useSearchMatchSync({
    isThisTabActive,
    isSearchActive,
    conversation: displayConversation,
    shouldVirtualize,
    scrollContainerRef,
    currentSearchIndex,
    searchMatches,
    syncSearchMatchesWithRendered,
  });

  const { registerAIGroupRef } = useVisibleAIGroup({
    onVisibleChange: (aiGroupId) => {
      if (effectiveTabId) {
        setTabVisibleAIGroup(effectiveTabId, aiGroupId);
      }
    },
    threshold: 0.5,
    rootRef: scrollContainerRef,
  });

  const { showScrollButton, checkScrollButton, scrollToBottom, setShowScrollButton } =
    useChatHistoryScroll({
      scrollContainerRef,
      conversation: displayConversation,
      conversationLoading,
      isThisTabActive,
      effectiveTabId,
      savedScrollTop,
      saveScrollPosition,
      shouldDisableAutoScroll,
      currentSearchIndex,
      searchMatches,
      ensureGroupVisible,
      aiGroupRefs,
      chatItemRefs,
    });

  useTurnNavigationListener({
    isThisTabActive,
    conversation: displayConversation,
    effectiveTabId,
    shouldVirtualize,
    rowVirtualizer,
    aiGroupRefs,
    navigationHighlightTimerRef,
    setHighlightedGroupId,
    setIsNavigationHighlight,
  });

  const { registerAIGroupRefCombined, registerChatItemRef, registerToolRef } = useChatHistoryRefs(
    registerAIGroupRef,
    aiGroupRefs,
    chatItemRefs,
    toolItemRefs
  );

  const { handleNavigateToTurn, handleNavigateToUserGroup, handleNavigateToTool } =
    useChatHistoryNavigation({
      conversation: nerdConversation,
      ensureGroupVisible,
      aiGroupRefs,
      chatItemRefs,
      toolItemRefs,
      navigationHighlightTimerRef,
      setHighlightedGroupId,
      setIsNavigationHighlight,
      setContextNavToolUseId,
    });

  useEffect(() => {
    const ref = navigationHighlightTimerRef;
    return () => {
      const timer = ref.current;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // ponytail: useCallback required — captures rowVirtualizer in dep array; passed to SessionMinimap
  const handleMinimapJump = useCallback(
    (index: number) => {
      if (!displayConversation) return;
      const item = displayConversation.items[index];
      if (!item) return;

      if (shouldVirtualize) {
        rowVirtualizer.scrollToIndex(index, { align: 'start', behavior: 'smooth' });
      } else {
        const el =
          chatItemRefs.current.get(item.group.id) ?? aiGroupRefs.current.get(item.group.id);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    [displayConversation, shouldVirtualize, rowVirtualizer]
  );

  if (conversationLoading) return <ChatHistoryLoadingState />;

  if (!displayConversation || displayConversation.items.length === 0) {
    return (
      <div className="bg-background flex flex-1 items-center justify-center overflow-hidden">
        <div className="text-muted-foreground space-y-2 text-center">
          <MessageSquare className="mx-auto mb-4 size-12 opacity-30" />
          <div className="text-muted-foreground text-xl font-medium">No conversation history</div>
          <div className="text-sm">This session does not contain any messages yet.</div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="log"
      aria-label="Chat history"
      className="bg-background relative flex flex-1 flex-col overflow-hidden"
    >
      <SearchBar conversation={displayConversation} />
      {!isSimple && (
        <>
          <LiveMetricsBar
            metrics={sessionDetail?.metrics ?? null}
            isStreaming={isStreaming}
            startTime={sessionDetail?.session?.createdAt ?? null}
          />
          <ReplayControls totalChunks={displayConversation.items.length} />
        </>
      )}
      <div className="relative flex flex-1 overflow-hidden">
        <div
          ref={scrollContainerRef}
          className="bg-background flex-1 overflow-y-auto"
          onScroll={checkScrollButton}
        >
          {!isSimple && (allContextInjections.length > 0 || hasTodoData) && (
            <ChatHistoryToolbar
              showHeatmapButton={!!sessionContextStats && sessionContextStats.size > 0}
              contextHeatmapVisible={contextHeatmapVisible}
              onToggleHeatmap={() => toggleContextHeatmap()}
              hasTodoData={hasTodoData}
              isTodoPanelVisible={isTodoPanelVisible}
              onToggleTodo={() => setIsTodoPanelVisible(!isTodoPanelVisible)}
              todoPendingCount={todoPendingCount}
              contextInjectionCount={allContextInjections.length}
              isContextPanelVisible={isContextPanelVisible}
              onToggleContext={() => setContextPanelVisible(!isContextPanelVisible)}
              isContextButtonHovered={isContextButtonHovered}
              setIsContextButtonHovered={setIsContextButtonHovered}
            />
          )}
          {!isSimple &&
            contextHeatmapVisible &&
            sessionContextStats &&
            nerdConversation &&
            nerdConversation.items.length > 0 && (
              <div className="sticky top-12 z-10 mx-auto max-w-5xl px-6 pt-2 pb-1">
                <ContextHeatmap
                  items={nerdConversation.items}
                  statsMap={sessionContextStats}
                  onSelectTurn={(_groupId, turnIndex) => handleNavigateToTurn(turnIndex)}
                />
              </div>
          )}
          <div
            className={cn(
              'mx-auto max-w-5xl px-6 py-8',
              allContextInjections.length > 0 && '-mt-8'
            )}
          >
            {!isSimple &&
              (sessionDetail?.session?.customTitle || sessionDetail?.session?.agentName) && (
                <div className="mb-6">
                  {sessionDetail.session.customTitle && (
                    <h1 className="text-foreground text-lg font-semibold">
                      {sessionDetail.session.customTitle}
                    </h1>
                  )}
                  {sessionDetail.session.agentName &&
                    sessionDetail.session.agentName !== sessionDetail.session.customTitle && (
                      <p className="text-muted-foreground mt-1 text-sm">
                        Agent: {sessionDetail.session.agentName}
                      </p>
                    )}
                </div>
            )}
            <div className="space-y-6">
              <ChatHistoryVirtualizer
                items={displayConversation.items}
                shouldVirtualize={shouldVirtualize}
                rowVirtualizer={rowVirtualizer}
                replayMode={isSimple ? 'off' : replayMode}
                replayCursorIndex={isSimple ? 0 : replayCursorIndex}
                highlightedGroupId={highlightedGroupId}
                highlightToolUseId={effectiveHighlightToolUseId}
                isSearchHighlight={isSearchHighlight}
                isNavigationHighlight={isNavigationHighlight}
                highlightColor={effectiveHighlightColor}
                registerChatItemRef={registerChatItemRef}
                registerAIGroupRef={registerAIGroupRefCombined}
                registerToolRef={registerToolRef}
              />
            </div>
          </div>
        </div>

        {showScrollButton && (
          <button
            onClick={() => {
              scrollToBottom('smooth');
              setShowScrollButton(false);
            }}
            className="text-muted-foreground border-border bg-muted absolute bottom-5 z-20 flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs shadow-lg backdrop-blur-md transition-all"
            style={{
              right:
                isContextPanelVisible && allContextInjections.length > 0
                  ? `calc(${CONTEXT_PANEL_WIDTH_PX}px + 1rem)`
                  : '1rem',
            }}
            title="Scroll to bottom"
          >
            <ChevronsDown className="size-3.5" />
            <span>Bottom</span>
          </button>
        )}

        {!isSimple && nerdConversation && (
          <ChatHistorySidePanels
            items={nerdConversation.items}
            scrollContainerRef={scrollContainerRef}
            onMinimapJump={handleMinimapJump}
            isTodoPanelVisible={isTodoPanelVisible}
            hasTodoData={hasTodoData}
            todoData={todoData}
            onCloseTodo={() => setIsTodoPanelVisible(false)}
            isContextPanelVisible={isContextPanelVisible}
            contextInjections={allContextInjections}
            onCloseContext={() => setContextPanelVisible(false)}
            projectRoot={sessionDetail?.session?.projectPath}
            onNavigateToTurn={handleNavigateToTurn}
            onNavigateToTool={handleNavigateToTool}
            onNavigateToUserGroup={handleNavigateToUserGroup}
            totalSessionTokens={lastAiGroupTotalTokens}
            phaseInfo={sessionPhaseInfo ?? undefined}
            selectedPhase={selectedContextPhase}
            onPhaseChange={setSelectedContextPhase}
          />
        )}
      </div>
    </div>
  );
};
