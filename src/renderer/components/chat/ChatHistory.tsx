import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useChatHistoryScroll } from '@renderer/hooks/useChatHistoryScroll';
import { useTabNavigationController } from '@renderer/hooks/useTabNavigationController';
import { useTabUI } from '@renderer/hooks/useTabUI';
import { useTurnNavigationListener } from '@renderer/hooks/useTurnNavigationListener';
import { useVisibleAIGroup } from '@renderer/hooks/useVisibleAIGroup';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { countPendingTodos } from '@renderer/types/todos';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronsDown } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { LiveMetricsBar } from '../common/LiveMetricsBar';

import { ChatHistoryEmptyState } from './ChatHistoryEmptyState';
import { ChatHistoryLoadingState } from './ChatHistoryLoadingState';
import { ChatHistoryVirtualizer } from './ChatHistoryVirtualizer';
import { ContextHeatmap } from './ContextHeatmap';
import { ReplayControls } from './ReplayControls';
import { SessionContextPanel } from './SessionContextPanel/index';
import { SessionMinimap } from './SessionMinimap';
import { TodoPanel } from './TodoPanel';
import { computeContextInjectionsForPhase } from './chatHistoryDerivations';
import { useChatHistoryNavigation } from './useChatHistoryNavigation';
import { useSearchMatchSync } from './useSearchMatchSync';

const CONTEXT_PANEL_WIDTH_PX = 320;

function waitForDoubleRaf(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
}

interface ChatHistoryProps {
  tabId?: string;
}

export const ChatHistory = ({ tabId }: ChatHistoryProps): JSX.Element => {
  const VIRTUALIZATION_THRESHOLD = 120;
  const ESTIMATED_CHAT_ITEM_HEIGHT = 260;

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

  const [isContextButtonHovered, setIsContextButtonHovered] = useState(false);

  const effectiveTabId = tabId ?? activeTabId;
  const isThisTabActive = effectiveTabId === activeTabId;

  const thisTab = effectiveTabId ? openTabs.find((t) => t.id === effectiveTabId) : null;
  const pendingNavigation = thisTab?.pendingNavigation;

  const { allContextInjections, lastAiGroupTotalTokens } = useMemo(
    () =>
      computeContextInjectionsForPhase({
        conversation,
        contextStats: sessionContextStats,
        phaseInfo: sessionPhaseInfo,
        selectedPhase: selectedContextPhase,
      }),
    [sessionContextStats, conversation, selectedContextPhase, sessionPhaseInfo]
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
  const shouldVirtualize = (conversation?.items.length ?? 0) >= VIRTUALIZATION_THRESHOLD;

  const setSearchQueryForTab = useCallback(
    (query: string): void => {
      setSearchQuery(query, conversation);
    },
    [setSearchQuery, conversation]
  );

  const groupIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!conversation?.items) {
      return map;
    }
    conversation.items.forEach((item, index) => {
      map.set(item.group.id, index);
    });
    return map;
  }, [conversation]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? (conversation?.items.length ?? 0) : 0,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ESTIMATED_CHAT_ITEM_HEIGHT,
    overscan: 8,
    measureElement: (element) => element.getBoundingClientRect().height,
  });

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
    isActiveTab: isThisTabActive,
    pendingNavigation,
    conversation,
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
    setSearchQuery(searchQuery, conversation);
  }, [isThisTabActive, searchQuery, conversation, setSearchQuery]);

  useSearchMatchSync({
    isThisTabActive,
    isSearchActive,
    conversation,
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
      conversation,
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
    conversation,
    effectiveTabId,
    shouldVirtualize,
    rowVirtualizer,
    aiGroupRefs,
    navigationHighlightTimerRef,
    setHighlightedGroupId,
    setIsNavigationHighlight,
  });

  const registerAIGroupRefCombined = useCallback(
    (groupId: string) => {
      const visibilityRef = registerAIGroupRef(groupId);
      return (el: HTMLElement | null) => {
        if (typeof visibilityRef === 'function') visibilityRef(el);
        if (el) aiGroupRefs.current.set(groupId, el);
        else aiGroupRefs.current.delete(groupId);
      };
    },
    [registerAIGroupRef]
  );

  const { handleNavigateToTurn, handleNavigateToUserGroup, handleNavigateToTool } =
    useChatHistoryNavigation({
      conversation,
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

  const registerChatItemRef = useCallback((groupId: string) => {
    return (el: HTMLElement | null) => {
      if (el) chatItemRefs.current.set(groupId, el);
      else chatItemRefs.current.delete(groupId);
    };
  }, []);

  const registerToolRef = useCallback((toolId: string, el: HTMLElement | null) => {
    if (el) toolItemRefs.current.set(toolId, el);
    else toolItemRefs.current.delete(toolId);
  }, []);

  const handleMinimapJump = useCallback(
    (index: number) => {
      if (!conversation) return;
      const item = conversation.items[index];
      if (!item) return;

      if (shouldVirtualize) {
        rowVirtualizer.scrollToIndex(index, { align: 'start', behavior: 'smooth' });
      } else {
        const el =
          chatItemRefs.current.get(item.group.id) ?? aiGroupRefs.current.get(item.group.id);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    [conversation, shouldVirtualize, rowVirtualizer]
  );

  if (conversationLoading) return <ChatHistoryLoadingState />;

  if (!conversation || conversation.items.length === 0) return <ChatHistoryEmptyState />;

  return (
    <div
      role="log"
      aria-label="Chat history"
      className="bg-background flex flex-1 flex-col overflow-hidden"
    >
      <LiveMetricsBar
        metrics={sessionDetail?.metrics ?? null}
        isStreaming={isStreaming}
        startTime={sessionDetail?.session?.createdAt ?? null}
      />
      <ReplayControls totalChunks={conversation.items.length} />
      <div className="relative flex flex-1 overflow-hidden">
        <div
          ref={scrollContainerRef}
          className="bg-background flex-1 overflow-y-auto"
          onScroll={checkScrollButton}
        >
          {(allContextInjections.length > 0 || hasTodoData) && (
            <div className="pointer-events-none sticky top-0 z-10 flex justify-end gap-1.5 px-4 pt-3 pb-0">
              {sessionContextStats && sessionContextStats.size > 0 && (
                <button
                  onClick={() => toggleContextHeatmap()}
                  className={cn(
                    'pointer-events-auto flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs shadow-lg backdrop-blur-md transition-colors',
                    contextHeatmapVisible
                      ? 'bg-violet-500/45 text-violet-100'
                      : 'bg-muted text-muted-foreground hover:bg-accent'
                  )}
                  title={contextHeatmapVisible ? 'Hide context heatmap' : 'Show context heatmap'}
                >
                  Heatmap
                </button>
              )}
              {hasTodoData && (
                <button
                  onClick={() => setIsTodoPanelVisible(!isTodoPanelVisible)}
                  className={cn(
                    'pointer-events-auto flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs shadow-lg backdrop-blur-md transition-colors',
                    isTodoPanelVisible
                      ? 'bg-emerald-500/45 text-emerald-100'
                      : 'bg-muted text-muted-foreground hover:bg-accent'
                  )}
                >
                  Tasks ({todoPendingCount})
                </button>
              )}
              {allContextInjections.length > 0 && (
                <button
                  onClick={() => setContextPanelVisible(!isContextPanelVisible)}
                  onMouseEnter={() => setIsContextButtonHovered(true)}
                  onMouseLeave={() => setIsContextButtonHovered(false)}
                  className={cn(
                    'pointer-events-auto flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs shadow-lg backdrop-blur-md transition-colors',
                    isContextPanelVisible
                      ? 'bg-indigo-500/45 text-indigo-100'
                      : isContextButtonHovered
                        ? 'hover:bg-accent text-muted-foreground'
                        : 'bg-muted text-muted-foreground'
                  )}
                >
                  Context ({allContextInjections.length})
                </button>
              )}
            </div>
          )}
          {contextHeatmapVisible && sessionContextStats && conversation.items.length > 0 && (
            <div className="sticky top-12 z-10 mx-auto max-w-5xl px-6 pt-2 pb-1">
              <ContextHeatmap
                items={conversation.items}
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
            {(sessionDetail?.session?.customTitle || sessionDetail?.session?.agentName) && (
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
                items={conversation.items}
                shouldVirtualize={shouldVirtualize}
                rowVirtualizer={rowVirtualizer}
                replayMode={replayMode}
                replayCursorIndex={replayCursorIndex}
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

        {conversation.items.length >= 5 && (
          <SessionMinimap
            items={conversation.items}
            scrollContainerRef={scrollContainerRef}
            onJumpToIndex={handleMinimapJump}
            className="border-border/30 border-l"
          />
        )}

        {isTodoPanelVisible && hasTodoData && (
          <div className="border-border w-72 shrink-0 border-l">
            <TodoPanel todoData={todoData} onClose={() => setIsTodoPanelVisible(false)} />
          </div>
        )}

        {isContextPanelVisible && allContextInjections.length > 0 && (
          <div className="w-80 shrink-0">
            <SessionContextPanel
              injections={allContextInjections}
              onClose={() => setContextPanelVisible(false)}
              projectRoot={sessionDetail?.session?.projectPath}
              onNavigateToTurn={handleNavigateToTurn}
              onNavigateToTool={handleNavigateToTool}
              onNavigateToUserGroup={handleNavigateToUserGroup}
              totalSessionTokens={lastAiGroupTotalTokens}
              phaseInfo={sessionPhaseInfo ?? undefined}
              selectedPhase={selectedContextPhase}
              onPhaseChange={setSelectedContextPhase}
            />
          </div>
        )}
      </div>
    </div>
  );
};
