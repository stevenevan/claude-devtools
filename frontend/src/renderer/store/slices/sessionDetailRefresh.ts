/**
 * refreshSessionInPlace body, extracted from sessionDetailSlice.
 *
 * Background incremental refresh used by file-change events. No loading
 * states, no UI resets — preserves the user's current view so live
 * updates don't flicker.
 */
import { api } from '@renderer/api';
import { asEnhancedChunkArray } from '@renderer/types/data';
import { transformChunksToConversation } from '@renderer/utils/groupTransformer';
import { createLogger } from '@shared/utils/logger';

import { getAllTabs } from '../utils/paneHelpers';

import type { AppState } from '../types';
import type { AIGroup } from '@renderer/types/groups';

const logger = createLogger('Store:sessionDetail:refresh');

const sessionRefreshGeneration = new Map<string, number>();
const sessionRefreshInFlight = new Set<string>();
const sessionRefreshQueued = new Set<string>();

type Get = () => AppState;
type Set = (
  partial: Partial<AppState> | ((state: AppState) => Partial<AppState>),
  replace?: false
) => void;

export async function refreshSessionInPlaceAction(
  get: Get,
  set: Set,
  projectId: string,
  sessionId: string
): Promise<void> {
  const currentState = get();
  const allTabs = getAllTabs(currentState.paneLayout);
  const tabsViewingSession = allTabs.filter(
    (t) => t.type === 'session' && t.sessionId === sessionId
  );

  if (currentState.selectedSessionId !== sessionId && tabsViewingSession.length === 0) {
    return;
  }

  const refreshKey = `${projectId}/${sessionId}`;

  if (sessionRefreshInFlight.has(refreshKey)) {
    sessionRefreshQueued.add(refreshKey);
    return;
  }
  const generation = (sessionRefreshGeneration.get(refreshKey) ?? 0) + 1;
  sessionRefreshGeneration.set(refreshKey, generation);
  sessionRefreshInFlight.add(refreshKey);

  try {
    const detail = await api.getSessionDetailIncremental(projectId, sessionId);
    if (sessionRefreshGeneration.get(refreshKey) !== generation) return;
    if (!detail) return;

    const prevDetail = get().sessionDetail;
    if (
      detail.chunks.length > 0 &&
      detail.chunks.length === prevDetail?.chunks.length &&
      detail.chunks[detail.chunks.length - 1]?.id ===
        prevDetail.chunks[prevDetail.chunks.length - 1]?.id &&
      detail.session?.isOngoing === prevDetail.session?.isOngoing
    ) {
      return;
    }

    const isOngoing = detail.session?.isOngoing ?? false;
    const enhancedChunks = asEnhancedChunkArray(detail.chunks);
    if (!enhancedChunks) return;

    const newConversation = transformChunksToConversation(
      enhancedChunks,
      detail.processes,
      isOngoing
    );
    if (!newConversation) return;

    const latestState = get();
    const latestAllTabs = getAllTabs(latestState.paneLayout);
    const stillViewingSession =
      latestState.selectedSessionId === sessionId ||
      latestAllTabs.some((tab) => tab.type === 'session' && tab.sessionId === sessionId);
    if (!stillViewingSession) return;

    const currentVisibleId = currentState.visibleAIGroupId;
    const currentSelectedGroup = currentState.selectedAIGroup;

    const visibleGroupStillExists =
      currentVisibleId &&
      newConversation.items.some(
        (item) => item.type === 'ai' && item.group.id === currentVisibleId
      );

    let updatedSelectedGroup: AIGroup | null = currentSelectedGroup;
    if (visibleGroupStillExists && currentVisibleId) {
      const foundItem = newConversation.items.find(
        (item) => item.type === 'ai' && item.group.id === currentVisibleId
      );
      if (foundItem?.type === 'ai') {
        updatedSelectedGroup = foundItem.group;
      }
    }

    const prevGroupIds = new Set(
      (latestState.conversation?.items ?? [])
        .filter((item) => item.type === 'ai')
        .map((item) => (item as { type: 'ai'; group: { id: string } }).group.id)
    );

    set((state) => ({
      sessionDetail: detail,
      conversation: newConversation,
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, isOngoing: detail.session?.isOngoing ?? false } : s
      ),
      ...(visibleGroupStillExists ? { selectedAIGroup: updatedSelectedGroup } : {}),
    }));

    if (get().appConfig?.general?.autoExpandAIGroups) {
      const newGroupIds = newConversation.items
        .filter(
          (item) =>
            item.type === 'ai' &&
            !prevGroupIds.has((item as { type: 'ai'; group: { id: string } }).group.id)
        )
        .map((item) => (item as { type: 'ai'; group: { id: string } }).group.id);

      if (newGroupIds.length > 0) {
        for (const tab of latestAllTabs) {
          if (tab.type === 'session' && tab.sessionId === sessionId) {
            for (const groupId of newGroupIds) {
              get().expandAIGroupForTab(tab.id, groupId);
            }
          }
        }
      }
    }

    const latestTabSessionData = { ...get().tabSessionData };
    for (const tab of latestAllTabs) {
      if (tab.type === 'session' && tab.sessionId === sessionId && latestTabSessionData[tab.id]) {
        const tabData = latestTabSessionData[tab.id];
        const tabVisibleId = tabData.visibleAIGroupId;
        const tabGroupStillExists =
          tabVisibleId &&
          newConversation.items.some(
            (item) => item.type === 'ai' && item.group.id === tabVisibleId
          );
        let tabSelectedGroup = tabData.selectedAIGroup;
        if (tabGroupStillExists && tabVisibleId) {
          const found = newConversation.items.find(
            (item) => item.type === 'ai' && item.group.id === tabVisibleId
          );
          if (found?.type === 'ai') tabSelectedGroup = found.group;
        }

        latestTabSessionData[tab.id] = {
          ...tabData,
          sessionDetail: detail,
          conversation: newConversation,
          isStreaming: detail.session?.isOngoing ?? false,
          ...(tabGroupStillExists ? { selectedAIGroup: tabSelectedGroup } : {}),
        };
      }
    }
    set({ tabSessionData: latestTabSessionData });
  } catch (error) {
    logger.error('refreshSessionInPlace error:', error);
  } finally {
    sessionRefreshInFlight.delete(refreshKey);
    if (sessionRefreshQueued.has(refreshKey)) {
      sessionRefreshQueued.delete(refreshKey);
      void get().refreshSessionInPlace(projectId, sessionId);
    }
  }
}
