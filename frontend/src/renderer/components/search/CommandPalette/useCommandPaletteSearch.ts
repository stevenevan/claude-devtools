import { useCallback, useEffect, useMemo, useRef, useState, Dispatch, SetStateAction } from 'react';

import { api } from '@renderer/api';
import { useStore } from '@renderer/store';
import { createLogger } from '@shared/utils/logger';
import { useShallow } from 'zustand/react/shallow';

import type { RepositoryGroup, SearchResult, SessionDetail } from '@renderer/types/data';

const logger = createLogger('Component:CommandPalette');

type SearchMode = 'projects' | 'sessions';

interface UseCommandPaletteSearch {
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  globalSearchEnabled: boolean;
  setGlobalSearchEnabled: Dispatch<SetStateAction<boolean>>;
  searchMode: SearchMode;
  filteredProjects: RepositoryGroup[];
  sessionResults: SearchResult[];
  loading: boolean;
  totalMatches: number;
  searchIsPartial: boolean;
  commandPaletteOpen: boolean;
  closeCommandPalette: () => void;
  repositoryGroups: RepositoryGroup[];
  selectedProjectId: string | null;
  sessionDetail: SessionDetail | null;
  setHelpPanelOpen: (open: boolean) => void;
  handleProjectSelect: (repoId: string) => void;
  handleSessionSelect: (result: SearchResult) => void;
  handleOpenChange: (open: boolean) => void;
}

export const useCommandPaletteSearch = (): UseCommandPaletteSearch => {
  const {
    commandPaletteOpen,
    closeCommandPalette,
    selectedProjectId,
    navigateToSession,
    repositoryGroups,
    fetchRepositoryGroups,
    selectRepository,
    sessionDetail,
    setHelpPanelOpen,
  } = useStore(
    useShallow((s) => ({
      commandPaletteOpen: s.commandPaletteOpen,
      closeCommandPalette: s.closeCommandPalette,
      selectedProjectId: s.selectedProjectId,
      navigateToSession: s.navigateToSession,
      repositoryGroups: s.repositoryGroups,
      fetchRepositoryGroups: s.fetchRepositoryGroups,
      selectRepository: s.selectRepository,
      sessionDetail: s.sessionDetail,
      setHelpPanelOpen: s.setHelpPanelOpen,
    }))
  );

  const [query, setQuery] = useState('');
  const [sessionResults, setSessionResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalMatches, setTotalMatches] = useState(0);
  const [searchIsPartial, setSearchIsPartial] = useState(false);
  const [globalSearchEnabled, setGlobalSearchEnabled] = useState(false);
  const latestSearchRequestRef = useRef(0);

  const searchMode: SearchMode = selectedProjectId || globalSearchEnabled ? 'sessions' : 'projects';

  const filteredProjects = useMemo(() => {
    if (searchMode !== 'projects' || query.trim().length < 1) {
      return repositoryGroups.slice(0, 10);
    }
    const q = query.toLowerCase().trim();
    return repositoryGroups
      .filter((repo) => {
        if (repo.name.toLowerCase().includes(q)) return true;
        const path = repo.worktrees[0]?.path || '';
        return path.toLowerCase().includes(q);
      })
      .slice(0, 10);
  }, [repositoryGroups, query, searchMode]);

  useEffect(() => {
    if (
      commandPaletteOpen &&
      (searchMode === 'projects' || globalSearchEnabled) &&
      repositoryGroups.length === 0
    ) {
      void fetchRepositoryGroups();
    }
  }, [
    commandPaletteOpen,
    searchMode,
    globalSearchEnabled,
    repositoryGroups.length,
    fetchRepositoryGroups,
  ]);

  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery('');
      setSessionResults([]);
      setTotalMatches(0);
      setSearchIsPartial(false);
      setGlobalSearchEnabled(false);
    }
  }, [commandPaletteOpen]);

  useEffect(() => {
    if (!commandPaletteOpen || query.trim().length < 2) {
      setSessionResults([]);
      setTotalMatches(0);
      setSearchIsPartial(false);
      return;
    }
    if (searchMode !== 'sessions' || (!globalSearchEnabled && !selectedProjectId)) {
      return;
    }

    const timeoutId = setTimeout(async () => {
      const requestId = latestSearchRequestRef.current + 1;
      latestSearchRequestRef.current = requestId;
      setLoading(true);
      try {
        const searchResult = globalSearchEnabled
          ? await api.searchAllProjects(query.trim(), 50)
          : await api.searchSessions(selectedProjectId!, query.trim(), 50);
        if (latestSearchRequestRef.current !== requestId) return;
        setSessionResults(searchResult.results);
        setTotalMatches(searchResult.totalMatches);
        setSearchIsPartial(!!searchResult.isPartial);
      } catch (error) {
        if (latestSearchRequestRef.current !== requestId) return;
        logger.error('Search error:', error);
        setSessionResults([]);
        setTotalMatches(0);
        setSearchIsPartial(false);
      } finally {
        if (latestSearchRequestRef.current === requestId) setLoading(false);
      }
    }, 400);

    return () => clearTimeout(timeoutId);
  }, [query, selectedProjectId, commandPaletteOpen, searchMode, globalSearchEnabled]);

  const handleProjectSelect = useCallback(
    (repoId: string) => {
      closeCommandPalette();
      selectRepository(repoId);
    },
    [closeCommandPalette, selectRepository]
  );

  const handleSessionSelect = useCallback(
    (result: SearchResult) => {
      closeCommandPalette();
      navigateToSession(result.projectId, result.sessionId, true, {
        query: query.trim(),
        messageTimestamp: result.timestamp,
        matchedText: result.matchedText,
        targetGroupId: result.groupId,
        targetMatchIndexInItem: result.matchIndexInItem,
        targetMatchStartOffset: result.matchStartOffset,
        targetMessageUuid: result.messageUuid,
      });
    },
    [closeCommandPalette, navigateToSession, query]
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) closeCommandPalette();
    },
    [closeCommandPalette]
  );

  return {
    query,
    setQuery,
    globalSearchEnabled,
    setGlobalSearchEnabled,
    searchMode,
    filteredProjects,
    sessionResults,
    loading,
    totalMatches,
    searchIsPartial,
    commandPaletteOpen,
    closeCommandPalette,
    repositoryGroups,
    selectedProjectId,
    sessionDetail,
    setHelpPanelOpen,
    handleProjectSelect,
    handleSessionSelect,
    handleOpenChange,
  };
};
