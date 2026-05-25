import { useMemo } from 'react';

import {
  getNonEmptyCategories,
  groupSessionsByDate,
  separatePinnedSessions,
} from '@renderer/utils/dateGrouping';

import type { VirtualItem } from './constants';
import type { SidebarFilter } from '../SidebarQuickFilters';
import type { BookmarkEntry } from '@renderer/store/slices/configSlice';
import type { SessionFilterState } from '@renderer/store/slices/sessionSlice';
import type { Session, SessionSortMode } from '@renderer/types/data';

interface UseSessionListItemsArgs {
  sessions: Session[];
  hiddenSet: Set<string>;
  showHiddenSessions: boolean;
  sidebarFilters: Set<SidebarFilter> | undefined;
  bookmarks: BookmarkEntry[];
  activeFilters: SessionFilterState;
  sessionTagsMap: Map<string, string[]>;
  pinnedSessionIds: string[];
  sessionSortMode: SessionSortMode;
  sessionsHasMore: boolean;
}

export function useSessionListItems({
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
}: UseSessionListItemsArgs): VirtualItem[] {
  const visibleSessions = useMemo(() => {
    if (showHiddenSessions) return sessions;
    return sessions.filter((s) => !hiddenSet.has(s.id));
  }, [sessions, hiddenSet, showHiddenSessions]);

  const bookmarkedSessionIds = useMemo(
    () => new Set(bookmarks.map((b) => b.sessionId)),
    [bookmarks]
  );

  const filteredSessions = useMemo(() => {
    const quickSet = sidebarFilters ?? new Set<SidebarFilter>();
    return visibleSessions.filter((s) => {
      if (quickSet.has('ongoing') && !s.isOngoing) return false;
      if (quickSet.has('subagents') && !s.hasSubagents) return false;
      if (quickSet.has('bookmarked') && !bookmarkedSessionIds.has(s.id)) return false;
      if (activeFilters.dateMin != null && s.createdAt < activeFilters.dateMin) return false;
      if (activeFilters.dateMax != null && s.createdAt > activeFilters.dateMax + 86_400_000)
        return false;
      if (
        activeFilters.minContext != null &&
        (s.contextConsumption ?? 0) < activeFilters.minContext
      )
        return false;
      if (
        activeFilters.maxContext != null &&
        (s.contextConsumption ?? 0) > activeFilters.maxContext
      )
        return false;
      if (
        activeFilters.minCompactions != null &&
        (s.compactionCount ?? 0) < activeFilters.minCompactions
      )
        return false;
      if (
        activeFilters.agentName &&
        (s.agentName ?? '').toLowerCase() !== activeFilters.agentName.toLowerCase()
      )
        return false;
      if (activeFilters.tags && activeFilters.tags.length > 0) {
        const tags = sessionTagsMap.get(s.id) ?? [];
        const match = activeFilters.tags.every((t) => tags.includes(t));
        if (!match) return false;
      }
      return true;
    });
  }, [visibleSessions, sidebarFilters, bookmarkedSessionIds, activeFilters, sessionTagsMap]);

  const { pinned: pinnedSessions, unpinned: unpinnedSessions } = useMemo(
    () => separatePinnedSessions(filteredSessions, pinnedSessionIds),
    [filteredSessions, pinnedSessionIds]
  );

  const groupedSessions = useMemo(() => groupSessionsByDate(unpinnedSessions), [unpinnedSessions]);

  const nonEmptyCategories = useMemo(
    () => getNonEmptyCategories(groupedSessions),
    [groupedSessions]
  );

  const contextSortedSessions = useMemo(() => {
    if (sessionSortMode !== 'most-context') return [];
    return [...visibleSessions].sort(
      (a, b) => (b.contextConsumption ?? 0) - (a.contextConsumption ?? 0)
    );
  }, [visibleSessions, sessionSortMode]);

  return useMemo((): VirtualItem[] => {
    const items: VirtualItem[] = [];

    if (sessionSortMode === 'most-context') {
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
}
