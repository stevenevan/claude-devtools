
import { api } from '@renderer/api';
import { asEnhancedChunkArray } from '@renderer/types/data';
import { findTabBySession, truncateLabel } from '@renderer/types/tabs';
import { processSessionClaudeMd } from '@renderer/utils/claudeMd';
import { processSessionContextWithPhases } from '@renderer/utils/contextTracker';
import { transformChunksToConversation } from '@renderer/utils/groupTransformer';
import { createLogger } from '@shared/utils/logger';

import { applyDirectoryTokenData, collectMentionedFilePaths } from './sessionDetailActions';
import { createEmptyTabSessionData } from './sessionDetailState';

import type { AppState } from '../types';
import type { ClaudeMdStats } from '@renderer/types/claudeMd';
import type {
  ContextPhaseInfo,
  ContextStats,
  MentionedFileInfo,
} from '@renderer/types/contextInjection';
import type { ClaudeMdFileInfo } from '@renderer/types/data';
import type { SessionConversation } from '@renderer/types/groups';

const logger = createLogger('Store:sessionDetail:fetch');

let sessionDetailFetchGeneration = 0;
let agentConfigsCachedForProject = '';

type Get = () => AppState;
type Set = (
  partial: Partial<AppState> | ((state: AppState) => Partial<AppState>),
  replace?: false
) => void;

export async function fetchSessionDetailAction(
  get: Get,
  set: Set,
  projectId: string,
  sessionId: string,
  tabId?: string
): Promise<void> {
  const requestGeneration = ++sessionDetailFetchGeneration;
  set({
    sessionDetailLoading: true,
    sessionDetailError: null,
    conversationLoading: true,
  });

  if (tabId) {
    const prev = get().tabSessionData;
    set({
      tabSessionData: {
        ...prev,
        [tabId]: {
          ...(prev[tabId] ?? createEmptyTabSessionData()),
          sessionDetailLoading: true,
          sessionDetailError: null,
          conversationLoading: true,
        },
      },
    });
  }

  try {
    const detail = await api.getSessionDetail(projectId, sessionId);
    if (requestGeneration !== sessionDetailFetchGeneration) return;

    const isOngoing = detail?.session?.isOngoing ?? false;
    const enhancedChunks = detail ? asEnhancedChunkArray(detail.chunks) : null;
    const conversation: SessionConversation | null =
      detail && enhancedChunks
        ? transformChunksToConversation(enhancedChunks, detail.processes, isOngoing)
        : null;

    const firstAIItem = conversation?.items?.find((item) => item.type === 'ai');
    const firstAIGroupId = firstAIItem?.type === 'ai' ? firstAIItem.group.id : null;
    const firstAIGroup = firstAIItem?.type === 'ai' ? firstAIItem.group : null;

    const projectRoot = detail?.session?.projectPath ?? '';
    const { connectionMode } = get();
    let claudeMdStats: Map<string, ClaudeMdStats> | null = null;
    let contextStats: Map<string, ContextStats> | null = null;
    let phaseInfo: ContextPhaseInfo | null = null;

    if (connectionMode !== 'ssh' && projectRoot && projectRoot !== agentConfigsCachedForProject) {
      agentConfigsCachedForProject = projectRoot;
      api
        .readAgentConfigs(projectRoot)
        .then((configs) => {
          set({ agentConfigs: configs });
        })
        .catch((err) => {
          logger.error('Failed to read agent configs:', err);
          agentConfigsCachedForProject = '';
        });
    }

    if (connectionMode !== 'ssh' && conversation?.items) {
      let claudeMdTokenData: Record<string, ClaudeMdFileInfo> = {};
      try {
        claudeMdTokenData = await api.readClaudeMdFiles(projectRoot);
        if (requestGeneration !== sessionDetailFetchGeneration) return;
      } catch (err) {
        logger.error('Failed to read CLAUDE.md files:', err);
      }

      claudeMdStats = processSessionClaudeMd(conversation.items, projectRoot, claudeMdTokenData);

      const directoryTokenData: Record<string, ClaudeMdFileInfo> = {};

      if (claudeMdStats && claudeMdStats.size > 0) {
        const directoryPaths = new Set<string>();
        for (const stats of claudeMdStats.values()) {
          for (const injection of stats.accumulatedInjections) {
            if (injection.source === 'directory') {
              directoryPaths.add(injection.path);
            }
          }
        }

        if (directoryPaths.size > 0) {
          const directoryTokens = new Map<string, number>();
          const nonExistentPaths = new Set<string>();

          const directoryResults = await Promise.all(
            Array.from(directoryPaths).map(async (fullPath) => {
              try {
                const dirPath = fullPath.replace(/[\\/]CLAUDE\.md$/, '');
                const fileInfo = await api.readDirectoryClaudeMd(dirPath);
                return { fullPath, fileInfo, error: false };
              } catch (err) {
                logger.error('Failed to read directory CLAUDE.md:', fullPath, err);
                return { fullPath, fileInfo: null, error: true };
              }
            })
          );
          if (requestGeneration !== sessionDetailFetchGeneration) return;

          for (const { fullPath, fileInfo, error } of directoryResults) {
            if (error || !fileInfo) {
              nonExistentPaths.add(fullPath);
            } else if (fileInfo.exists && fileInfo.estimatedTokens > 0) {
              directoryTokens.set(fullPath, fileInfo.estimatedTokens);
              directoryTokenData[fullPath] = fileInfo;
            } else {
              nonExistentPaths.add(fullPath);
            }
          }

          applyDirectoryTokenData(claudeMdStats, { directoryTokens, nonExistentPaths });
        }
      }

      const mentionedFilePaths = collectMentionedFilePaths(conversation.items, projectRoot);

      const mentionedFileTokenData = new Map<string, MentionedFileInfo>();
      const mentionedFileResults = await Promise.all(
        Array.from(mentionedFilePaths).map(async (filePath) => {
          try {
            const fileInfo = await api.readMentionedFile(filePath, projectRoot);
            return { filePath, fileInfo };
          } catch (err) {
            logger.error('Failed to read mentioned file:', filePath, err);
            return { filePath, fileInfo: null };
          }
        })
      );
      if (requestGeneration !== sessionDetailFetchGeneration) return;
      for (const { filePath, fileInfo } of mentionedFileResults) {
        if (fileInfo) mentionedFileTokenData.set(filePath, fileInfo);
      }

      const phaseResult = processSessionContextWithPhases(
        conversation.items,
        projectRoot,
        claudeMdTokenData,
        mentionedFileTokenData,
        directoryTokenData
      );
      contextStats = phaseResult.statsMap;
      phaseInfo = phaseResult.phaseInfo;
    }

    const currentState = get();
    if (requestGeneration !== sessionDetailFetchGeneration) return;

    const activeTab = currentState.getActiveTab();
    const stillViewingSession =
      currentState.selectedSessionId === sessionId ||
      (activeTab?.type === 'session' &&
        activeTab.sessionId === sessionId &&
        activeTab.projectId === projectId);
    if (!stillViewingSession) {
      set({ sessionDetailLoading: false, conversationLoading: false });
      return;
    }

    const existingTab = findTabBySession(currentState.openTabs, sessionId);
    if (existingTab && detail) {
      const newLabel = detail.session.customTitle
        ? truncateLabel(detail.session.customTitle)
        : detail.session.firstMessage
          ? truncateLabel(detail.session.firstMessage)
          : `Session ${sessionId.slice(0, 8)}`;
      currentState.updateTabLabel(existingTab.id, newLabel);
    }

    set({
      sessionDetail: detail,
      sessionDetailLoading: false,
      conversation,
      conversationLoading: false,
      visibleAIGroupId: firstAIGroupId,
      selectedAIGroup: firstAIGroup,
      sessionClaudeMdStats: claudeMdStats,
      sessionContextStats: contextStats,
      sessionPhaseInfo: phaseInfo,
    });

    if (tabId && conversation?.items && get().appConfig?.general?.autoExpandAIGroups) {
      for (const item of conversation.items) {
        if (item.type === 'ai') {
          get().expandAIGroupForTab(tabId, item.group.id);
        }
      }
    }

    if (tabId) {
      const prev = get().tabSessionData;
      set({
        tabSessionData: {
          ...prev,
          [tabId]: {
            sessionDetail: detail,
            conversation,
            conversationLoading: false,
            sessionDetailLoading: false,
            sessionDetailError: null,
            sessionClaudeMdStats: claudeMdStats,
            sessionContextStats: contextStats,
            sessionPhaseInfo: phaseInfo,
            visibleAIGroupId: firstAIGroupId,
            selectedAIGroup: firstAIGroup,
            isStreaming: detail?.session?.isOngoing ?? false,
          },
        },
      });
    }
  } catch (error) {
    logger.error('fetchSessionDetail error:', error);
    if (requestGeneration !== sessionDetailFetchGeneration) return;
    const errorMsg = error instanceof Error ? error.message : 'Failed to fetch session detail';
    set({
      sessionDetailError: errorMsg,
      sessionDetailLoading: false,
      conversationLoading: false,
    });

    if (tabId) {
      const prev = get().tabSessionData;
      set({
        tabSessionData: {
          ...prev,
          [tabId]: {
            ...(prev[tabId] ?? createEmptyTabSessionData()),
            sessionDetailError: errorMsg,
            sessionDetailLoading: false,
            conversationLoading: false,
          },
        },
      });
    }
  }
}
