import { JSX, useCallback, useEffect, useMemo, useRef } from 'react';
import { useStore } from '@renderer/store';
import { Skeleton } from '@renderer/components/ui/skeleton';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Loader2, MessageSquareOff, Pin } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { SessionItem } from '../SessionItem';

import { BulkActionBar } from './BulkActionBar';
import { HEADER_HEIGHT, LOADER_HEIGHT, OVERSCAN, SESSION_HEIGHT } from './constants';
import { HeaderToolbar } from './HeaderToolbar';
import { useSessionListItems } from './useSessionListItems';

import type { SidebarFilter } from '../SidebarQuickFilters';

interface DateGroupedSessionsProps {
  sidebarFilters?: Set<SidebarFilter>;
}

export const DateGroupedSessions = ({
  sidebarFilters,
}: DateGroupedSessionsProps = {}): JSX.Element => {
  const {
    sessions,
    selectedSessionId,
    selectedProjectId,
    sessionsLoading,
    sessionsError,
    sessionsHasMore,
    sessionsLoadingMore,
    fetchSessionsMore,
    pinnedSessionIds,
    sessionSortMode,
    setSessionSortMode,
    hiddenSessionIds,
    showHiddenSessions,
    toggleShowHiddenSessions,
    sidebarSelectedSessionIds,
    sidebarMultiSelectActive,
    toggleSidebarSessionSelection,
    clearSidebarSelection,
    toggleSidebarMultiSelect,
    hideMultipleSessions,
    unhideMultipleSessions,
    pinMultipleSessions,
    setSessionTagsAction,
    getSessionTagsAction,
  } = useStore(
    useShallow((s) => ({
      sessions: s.sessions,
      selectedSessionId: s.selectedSessionId,
      selectedProjectId: s.selectedProjectId,
      sessionsLoading: s.sessionsLoading,
      sessionsError: s.sessionsError,
      sessionsHasMore: s.sessionsHasMore,
      sessionsLoadingMore: s.sessionsLoadingMore,
      fetchSessionsMore: s.fetchSessionsMore,
      pinnedSessionIds: s.pinnedSessionIds,
      sessionSortMode: s.sessionSortMode,
      setSessionSortMode: s.setSessionSortMode,
      hiddenSessionIds: s.hiddenSessionIds,
      showHiddenSessions: s.showHiddenSessions,
      toggleShowHiddenSessions: s.toggleShowHiddenSessions,
      sidebarSelectedSessionIds: s.sidebarSelectedSessionIds,
      sidebarMultiSelectActive: s.sidebarMultiSelectActive,
      toggleSidebarSessionSelection: s.toggleSidebarSessionSelection,
      clearSidebarSelection: s.clearSidebarSelection,
      toggleSidebarMultiSelect: s.toggleSidebarMultiSelect,
      hideMultipleSessions: s.hideMultipleSessions,
      unhideMultipleSessions: s.unhideMultipleSessions,
      pinMultipleSessions: s.pinMultipleSessions,
      setSessionTagsAction: s.setSessionTags,
      getSessionTagsAction: s.getSessionTags,
    }))
  );

  const parentRef = useRef<HTMLDivElement>(null);

  const hiddenSet = useMemo(() => new Set(hiddenSessionIds), [hiddenSessionIds]);
  const hasHiddenSessions = hiddenSessionIds.length > 0;

  const bookmarks = useStore((s) => s.bookmarks);
  const activeFilters = useStore((s) => s.activeFilters);
  const sessionTagsMap = useStore((s) => s.sessionTags);

  const virtualItems = useSessionListItems({
    sessions,
    hiddenSet,
    showHiddenSessions,
    sidebarFilters,
    bookmarks,
    activeFilters,
    sessionTagsMap,
    pinnedSessionIds,
    sessionSortMode,
    sessionsHasMore,
  });

  // ponytail: useCallback required — passed to useVirtualizer, deps change on virtualItems
  const estimateSize = useCallback(
    (index: number) => {
      const item = virtualItems[index];
      if (!item) return SESSION_HEIGHT;

      switch (item.type) {
        case 'header':
        case 'pinned-header':
          return HEADER_HEIGHT;
        case 'loader':
          return LOADER_HEIGHT;
        case 'session':
        default:
          return SESSION_HEIGHT;
      }
    },
    [virtualItems]
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual API limitation, not fixable in user code
  const rowVirtualizer = useVirtualizer({
    count: virtualItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: OVERSCAN,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualRowsLength = virtualRows.length;

  useEffect(() => {
    if (virtualRowsLength === 0) return;

    const lastItem = virtualRows[virtualRowsLength - 1];
    if (!lastItem) return;

    if (
      lastItem.index >= virtualItems.length - 3 &&
      sessionsHasMore &&
      !sessionsLoadingMore &&
      !sessionsLoading
    ) {
      void fetchSessionsMore();
    }
  }, [
    virtualRows,
    virtualRowsLength,
    virtualItems.length,
    sessionsHasMore,
    sessionsLoadingMore,
    sessionsLoading,
    fetchSessionsMore,
  ]);

  const selectedSet = useMemo(
    () => new Set(sidebarSelectedSessionIds),
    [sidebarSelectedSessionIds]
  );
  const someSelectedAreHidden = useMemo(
    () => sidebarSelectedSessionIds.some((id) => hiddenSet.has(id)),
    [sidebarSelectedSessionIds, hiddenSet]
  );

  const handleBulkHide = () => {
    void hideMultipleSessions(sidebarSelectedSessionIds);
    clearSidebarSelection();
  };

  const handleBulkUnhide = () => {
    const hiddenSelected = sidebarSelectedSessionIds.filter((id) => hiddenSet.has(id));
    void unhideMultipleSessions(hiddenSelected);
    clearSidebarSelection();
  };

  const handleBulkPin = () => {
    void pinMultipleSessions(sidebarSelectedSessionIds);
    clearSidebarSelection();
  };

  const handleBulkTag = () => {
    const input = window.prompt('Tag to apply to selected sessions');
    const trimmed = input?.trim();
    if (!trimmed) return;
    const tasks = sidebarSelectedSessionIds.map(async (id) => {
      const current = getSessionTagsAction(id);
      if (current.includes(trimmed)) return;
      await setSessionTagsAction(id, [...current, trimmed]);
    });
    void Promise.all(tasks).then(() => clearSidebarSelection());
  };

  if (!selectedProjectId) {
    return (
      <div className="p-4">
        <div className="text-muted-foreground py-8 text-center text-sm">
          <p>Select a project to view sessions</p>
        </div>
      </div>
    );
  }

  if (sessionsLoading && sessions.length === 0) {
    const skeletonWidths = [
      { header: '30%', title: '75%', sub: '90%' },
      { header: '22%', title: '60%', sub: '80%' },
      { header: '26%', title: '85%', sub: '65%' },
    ];
    return (
      <div className="p-4">
        <div className="space-y-3">
          {skeletonWidths.map((w, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 rounded-xs" style={{ width: w.header }} />
              <Skeleton className="h-4 rounded-xs" style={{ width: w.title }} />
              <Skeleton className="h-3 rounded-xs" style={{ width: w.sub }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (sessionsError) {
    return (
      <div className="p-4">
        <div className="border-border bg-card text-muted-foreground rounded-lg border p-3 text-sm">
          <p className="text-foreground mb-1 font-semibold">Error loading sessions</p>
          <p>{sessionsError}</p>
        </div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="p-4">
        <div className="text-muted-foreground py-8 text-center text-sm">
          <MessageSquareOff className="mx-auto mb-2 size-8 opacity-50" />
          <p className="mb-2">No sessions found</p>
          <p className="text-xs opacity-70">This project has no sessions yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <HeaderToolbar
        sessions={sessions}
        sessionsHasMore={sessionsHasMore}
        sessionSortMode={sessionSortMode}
        setSessionSortMode={setSessionSortMode}
        sidebarMultiSelectActive={sidebarMultiSelectActive}
        toggleSidebarMultiSelect={toggleSidebarMultiSelect}
        hasHiddenSessions={hasHiddenSessions}
        showHiddenSessions={showHiddenSessions}
        toggleShowHiddenSessions={toggleShowHiddenSessions}
      />

      {sidebarMultiSelectActive && sidebarSelectedSessionIds.length > 0 && (
        <BulkActionBar
          selectedCount={sidebarSelectedSessionIds.length}
          someSelectedAreHidden={someSelectedAreHidden}
          showHiddenSessions={showHiddenSessions}
          onPin={handleBulkPin}
          onTag={handleBulkTag}
          onHide={handleBulkHide}
          onUnhide={handleBulkUnhide}
          onClear={clearSidebarSelection}
        />
      )}

      <div ref={parentRef} className="flex-1 overflow-y-auto">
        <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const item = virtualItems[virtualRow.index];
            if (!item) return null;

            return (
              <div
                key={virtualRow.key}
                className="absolute top-0 left-0 w-full"
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {item.type === 'pinned-header' ? (
                  <div className="border-border text-muted-foreground bg-sidebar/95 sticky top-0 flex h-full items-center gap-1.5 border-t px-4 py-1.5 text-[11px] font-semibold tracking-wider uppercase backdrop-blur-xs">
                    <Pin className="size-3" />
                    Pinned
                  </div>
                ) : item.type === 'header' ? (
                  <div className="border-border text-muted-foreground bg-sidebar/95 sticky top-0 flex h-full items-center border-t px-4 py-1.5 text-[11px] font-semibold tracking-wider uppercase backdrop-blur-xs">
                    {item.category}
                  </div>
                ) : item.type === 'loader' ? (
                  <div className="text-muted-foreground flex h-full items-center justify-center">
                    {sessionsLoadingMore ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        <span className="text-xs">Loading more sessions...</span>
                      </>
                    ) : (
                      <span className="text-xs opacity-50">Scroll to load more</span>
                    )}
                  </div>
                ) : (
                  <SessionItem
                    session={item.session}
                    isActive={selectedSessionId === item.session.id}
                    isPinned={item.isPinned}
                    isHidden={item.isHidden}
                    multiSelectActive={sidebarMultiSelectActive}
                    isSelected={selectedSet.has(item.session.id)}
                    onToggleSelect={() => toggleSidebarSessionSelection(item.session.id)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
