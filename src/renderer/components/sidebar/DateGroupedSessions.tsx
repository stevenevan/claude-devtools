/**
 * DateGroupedSessions - Sessions organized by date categories with virtual scrolling.
 * Uses @tanstack/react-virtual for efficient DOM rendering with infinite scroll.
 * Supports multi-select with bulk actions and hidden session filtering.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import {
  getNonEmptyCategories,
  groupSessionsByDate,
  separatePinnedSessions,
} from '@renderer/utils/dateGrouping';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowDownWideNarrow,
  Calendar,
  CheckSquare,
  Eye,
  EyeOff,
  Loader2,
  MessageSquareOff,
  Pin,
  X,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { SessionItem } from './SessionItem';

import type { Session } from '@renderer/types/data';
import type { DateCategory } from '@renderer/types/tabs';

// Virtual list item types
type VirtualItem =
  | { type: 'header'; category: DateCategory; id: string }
  | { type: 'pinned-header'; id: string }
  | { type: 'session'; session: Session; isPinned: boolean; isHidden: boolean; id: string }
  | { type: 'loader'; id: string };

/**
 * Item height constants for virtual scroll positioning.
 * CRITICAL: These values MUST match the actual rendered heights of components.
 * If SessionItem height changes, update SESSION_HEIGHT here AND add h-[Xpx] to SessionItem.
 * Mismatch causes items to overlap!
 */
const HEADER_HEIGHT = 28;
const SESSION_HEIGHT = 48; // Must match h-[48px] in SessionItem.tsx
const LOADER_HEIGHT = 36;
const OVERSCAN = 5;

export const DateGroupedSessions = (): React.JSX.Element => {
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
    }))
  );

  const parentRef = useRef<HTMLDivElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const [showCountTooltip, setShowCountTooltip] = useState(false);

  const hiddenSet = useMemo(() => new Set(hiddenSessionIds), [hiddenSessionIds]);
  const hasHiddenSessions = hiddenSessionIds.length > 0;

  // Filter out hidden sessions unless showHiddenSessions is on
  const visibleSessions = useMemo(() => {
    if (showHiddenSessions) return sessions;
    return sessions.filter((s) => !hiddenSet.has(s.id));
  }, [sessions, hiddenSet, showHiddenSessions]);

  // Separate pinned sessions from unpinned
  const { pinned: pinnedSessions, unpinned: unpinnedSessions } = useMemo(
    () => separatePinnedSessions(visibleSessions, pinnedSessionIds),
    [visibleSessions, pinnedSessionIds]
  );

  // Group only unpinned sessions by date
  const groupedSessions = useMemo(() => groupSessionsByDate(unpinnedSessions), [unpinnedSessions]);

  // Get non-empty categories in display order
  const nonEmptyCategories = useMemo(
    () => getNonEmptyCategories(groupedSessions),
    [groupedSessions]
  );

  // Sessions sorted by context consumption (for most-context sort mode)
  const contextSortedSessions = useMemo(() => {
    if (sessionSortMode !== 'most-context') return [];
    return [...visibleSessions].sort(
      (a, b) => (b.contextConsumption ?? 0) - (a.contextConsumption ?? 0)
    );
  }, [visibleSessions, sessionSortMode]);

  // Flatten sessions with date headers into virtual list items
  const virtualItems = useMemo((): VirtualItem[] => {
    const items: VirtualItem[] = [];

    if (sessionSortMode === 'most-context') {
      // Flat list sorted by consumption - no date headers, no pinned section
      for (const session of contextSortedSessions) {
        items.push({
          type: 'session',
          session,
          isPinned: pinnedSessionIds.includes(session.id),
          isHidden: hiddenSet.has(session.id),
          id: `session-${session.id}`,
        });
      }
    } else {
      // Default: date-grouped view with pinned section
      if (pinnedSessions.length > 0) {
        items.push({
          type: 'pinned-header',
          id: 'header-pinned',
        });

        for (const session of pinnedSessions) {
          items.push({
            type: 'session',
            session,
            isPinned: true,
            isHidden: hiddenSet.has(session.id),
            id: `session-${session.id}`,
          });
        }
      }

      for (const category of nonEmptyCategories) {
        items.push({
          type: 'header',
          category,
          id: `header-${category}`,
        });

        for (const session of groupedSessions[category]) {
          items.push({
            type: 'session',
            session,
            isPinned: false,
            isHidden: hiddenSet.has(session.id),
            id: `session-${session.id}`,
          });
        }
      }
    }

    // Add loader item if there are more sessions to load
    if (sessionsHasMore) {
      items.push({
        type: 'loader',
        id: 'loader',
      });
    }

    return items;
  }, [
    sessionSortMode,
    contextSortedSessions,
    pinnedSessionIds,
    hiddenSet,
    pinnedSessions,
    nonEmptyCategories,
    groupedSessions,
    sessionsHasMore,
  ]);

  // Estimate item size based on type
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

  // Set up virtualizer
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual API limitation, not fixable in user code
  const rowVirtualizer = useVirtualizer({
    count: virtualItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: OVERSCAN,
  });

  // Get virtual items for dependency tracking
  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualRowsLength = virtualRows.length;

  // Load more when scrolling near end
  useEffect(() => {
    if (virtualRowsLength === 0) return;

    const lastItem = virtualRows[virtualRowsLength - 1];
    if (!lastItem) return;

    // If we're within 3 items of the end and there's more to load, fetch more
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

  // Bulk action helpers
  const selectedSet = useMemo(
    () => new Set(sidebarSelectedSessionIds),
    [sidebarSelectedSessionIds]
  );
  const someSelectedAreHidden = useMemo(
    () => sidebarSelectedSessionIds.some((id) => hiddenSet.has(id)),
    [sidebarSelectedSessionIds, hiddenSet]
  );

  const handleBulkHide = useCallback(() => {
    void hideMultipleSessions(sidebarSelectedSessionIds);
    clearSidebarSelection();
  }, [hideMultipleSessions, sidebarSelectedSessionIds, clearSidebarSelection]);

  const handleBulkUnhide = useCallback(() => {
    const hiddenSelected = sidebarSelectedSessionIds.filter((id) => hiddenSet.has(id));
    void unhideMultipleSessions(hiddenSelected);
    clearSidebarSelection();
  }, [unhideMultipleSessions, sidebarSelectedSessionIds, hiddenSet, clearSidebarSelection]);

  const handleBulkPin = useCallback(() => {
    void pinMultipleSessions(sidebarSelectedSessionIds);
    clearSidebarSelection();
  }, [pinMultipleSessions, sidebarSelectedSessionIds, clearSidebarSelection]);

  if (!selectedProjectId) {
    return (
      <div className="p-4">
        <div className="text-text-muted py-8 text-center text-sm">
          <p>Select a project to view sessions</p>
        </div>
      </div>
    );
  }

  if (sessionsLoading && sessions.length === 0) {
    const widths = [
      { header: '30%', title: '75%', sub: '90%' },
      { header: '22%', title: '60%', sub: '80%' },
      { header: '26%', title: '85%', sub: '65%' },
    ];

    return (
      <div className="p-4">
        <div className="space-y-3">
          {widths.map((w, i) => (
            <div key={i} className="space-y-2">
              <div
                className="skeleton-shimmer h-3 rounded-xs bg-[var(--skeleton-base-dim)]"
                style={{ width: w.header }}
              />
              <div
                className="skeleton-shimmer h-4 rounded-xs bg-[var(--skeleton-base)]"
                style={{ width: w.title }}
              />
              <div
                className="skeleton-shimmer h-3 rounded-xs bg-[var(--skeleton-base-dim)]"
                style={{ width: w.sub }}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (sessionsError) {
    return (
      <div className="p-4">
        <div className="border-border bg-surface-raised text-text-muted rounded-lg border p-3 text-sm">
          <p className="text-text mb-1 font-semibold">Error loading sessions</p>
          <p>{sessionsError}</p>
        </div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="p-4">
        <div className="text-text-muted py-8 text-center text-sm">
          <MessageSquareOff className="mx-auto mb-2 size-8 opacity-50" />
          <p className="mb-2">No sessions found</p>
          <p className="text-xs opacity-70">This project has no sessions yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="mt-2 flex items-center gap-2 px-4 py-3">
        <Calendar className="text-text-muted size-4" />
        <h2 className="text-text-muted text-xs tracking-wider uppercase">
          {sessionSortMode === 'most-context' ? 'By Context' : 'Sessions'}
        </h2>
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- tooltip trigger via hover, not interactive */}
        <span
          ref={countRef}
          className="text-text-muted text-xs opacity-60"
          onMouseEnter={() => setShowCountTooltip(true)}
          onMouseLeave={() => setShowCountTooltip(false)}
        >
          ({sessions.length}
          {sessionsHasMore ? '+' : ''})
        </span>
        {showCountTooltip &&
          sessionsHasMore &&
          countRef.current &&
          createPortal(
            <div
              className="border-border-emphasis bg-surface-overlay text-text-secondary pointer-events-none fixed z-50 w-48 rounded-md border px-2.5 py-1.5 text-[11px] leading-snug shadow-lg"
              style={{
                top: countRef.current.getBoundingClientRect().bottom + 6,
                left:
                  countRef.current.getBoundingClientRect().left +
                  countRef.current.getBoundingClientRect().width / 2 -
                  96,
              }}
            >
              {sessions.length} loaded so far — scroll down to load more. Context sorting only ranks
              loaded sessions.
            </div>,
            document.body
          )}
        <div className="ml-auto flex items-center gap-0.5">
          {/* Multi-select toggle */}
          <button
            onClick={toggleSidebarMultiSelect}
            className={cn(
              'rounded-sm p-1 transition-colors hover:bg-white/5',
              sidebarMultiSelectActive ? 'text-[#818cf8]' : 'text-text-muted'
            )}
            title={sidebarMultiSelectActive ? 'Exit selection mode' : 'Select sessions'}
          >
            <CheckSquare className="size-3.5" />
          </button>
          {/* Show hidden sessions toggle - only when hidden sessions exist */}
          {hasHiddenSessions && (
            <button
              onClick={toggleShowHiddenSessions}
              className={cn(
                'rounded-sm p-1 transition-colors hover:bg-white/5',
                showHiddenSessions ? 'text-[#818cf8]' : 'text-text-muted'
              )}
              title={showHiddenSessions ? 'Hide hidden sessions' : 'Show hidden sessions'}
            >
              {showHiddenSessions ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
            </button>
          )}
          {/* Sort mode toggle */}
          <button
            onClick={() =>
              setSessionSortMode(sessionSortMode === 'recent' ? 'most-context' : 'recent')
            }
            className={cn(
              'rounded-sm p-1 transition-colors hover:bg-white/5',
              sessionSortMode === 'most-context' ? 'text-[#818cf8]' : 'text-text-muted'
            )}
            title={sessionSortMode === 'recent' ? 'Sort by context consumption' : 'Sort by recent'}
          >
            <ArrowDownWideNarrow className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Bulk action bar - shown when sessions are selected */}
      {sidebarMultiSelectActive && sidebarSelectedSessionIds.length > 0 && (
        <div className="border-border bg-surface-raised flex items-center gap-1.5 border-b px-3 py-1.5">
          <span className="text-text-secondary text-[11px] font-medium">
            {sidebarSelectedSessionIds.length} selected
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={handleBulkPin}
              className="text-text-secondary rounded-sm px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:bg-white/5"
              title="Pin selected sessions"
            >
              <Pin className="inline-block size-3" /> Pin
            </button>
            <button
              onClick={handleBulkHide}
              className="text-text-secondary rounded-sm px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:bg-white/5"
              title="Hide selected sessions"
            >
              <EyeOff className="inline-block size-3" /> Hide
            </button>
            {showHiddenSessions && someSelectedAreHidden && (
              <button
                onClick={handleBulkUnhide}
                className="text-text-secondary rounded-sm px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:bg-white/5"
                title="Unhide selected sessions"
              >
                <Eye className="inline-block size-3" /> Unhide
              </button>
            )}
            <button
              onClick={clearSidebarSelection}
              className="text-text-muted rounded-sm p-0.5 transition-colors hover:bg-white/5"
              title="Cancel selection"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
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
                  <div className="border-border-emphasis text-text-muted sticky top-0 flex h-full items-center gap-1.5 border-t bg-[color-mix(in_srgb,var(--color-surface-sidebar)_95%,transparent)] px-4 py-1.5 text-[11px] font-semibold tracking-wider uppercase backdrop-blur-xs">
                    <Pin className="size-3" />
                    Pinned
                  </div>
                ) : item.type === 'header' ? (
                  <div className="border-border-emphasis text-text-muted sticky top-0 flex h-full items-center border-t bg-[color-mix(in_srgb,var(--color-surface-sidebar)_95%,transparent)] px-4 py-1.5 text-[11px] font-semibold tracking-wider uppercase backdrop-blur-xs">
                    {item.category}
                  </div>
                ) : item.type === 'loader' ? (
                  <div className="text-text-muted flex h-full items-center justify-center">
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
