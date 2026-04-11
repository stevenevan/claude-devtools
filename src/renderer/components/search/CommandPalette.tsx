import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@renderer/components/ui/command';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { formatModifierShortcut } from '@renderer/utils/keyboardUtils';
import { createLogger } from '@shared/utils/logger';
import { Command as CommandPrimitive } from 'cmdk';
import { formatDistanceToNow } from 'date-fns';
import { triggerDownload } from '@renderer/utils/sessionExporter';
import {
  Bot,
  Download,
  FileText,
  FolderGit2,
  Globe,
  Loader2,
  MessageSquare,
  Search,
  User,
  X,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { RepositoryGroup, SearchResult } from '@renderer/types/data';

const logger = createLogger('Component:CommandPalette');

type SearchMode = 'projects' | 'sessions';

export const CommandPalette = (): React.JSX.Element | null => {
  const {
    commandPaletteOpen,
    closeCommandPalette,
    selectedProjectId,
    navigateToSession,
    repositoryGroups,
    fetchRepositoryGroups,
    selectRepository,
    sessionDetail,
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

  const highlightMatch = useCallback((context: string, matchedText: string) => {
    const lowerContext = context.toLowerCase();
    const lowerMatch = matchedText.toLowerCase();
    const matchIndex = lowerContext.indexOf(lowerMatch);
    if (matchIndex === -1) return <span>{context}</span>;

    return (
      <>
        <span>{context.slice(0, matchIndex)}</span>
        <mark className="text-foreground rounded bg-yellow-400/20 px-0.5">
          {context.slice(matchIndex, matchIndex + matchedText.length)}
        </mark>
        <span>{context.slice(matchIndex + matchedText.length)}</span>
      </>
    );
  }, []);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) closeCommandPalette();
    },
    [closeCommandPalette]
  );

  const resultsCount = searchMode === 'projects' ? filteredProjects.length : sessionResults.length;

  return (
    <CommandDialog
      open={commandPaletteOpen}
      onOpenChange={handleOpenChange}
      title="Search"
      description="Search projects and conversations"
      showCloseButton={false}
      className="top-[15vh] max-w-2xl translate-y-0 gap-0 p-0"
    >
      <Command shouldFilter={false} className="rounded-none p-0">
        <div className="bg-card/50 border-border flex items-center justify-between gap-2 border-b px-4 py-2">
          <div className="flex items-center gap-2">
            {searchMode === 'projects' ? (
              <>
                <FolderGit2 className="text-muted-foreground size-3.5" />
                <span className="text-muted-foreground text-xs">Search projects</span>
              </>
            ) : (
              <>
                <MessageSquare className="text-muted-foreground size-3.5" />
                <span className="text-muted-foreground text-xs">
                  {globalSearchEnabled ? 'Search across all projects' : 'Search in project'}
                </span>
                {!globalSearchEnabled && (
                  <>
                    <span className="text-muted-foreground/50 mx-1 text-xs">·</span>
                    <span className="text-muted-foreground truncate text-xs">
                      {repositoryGroups.find((r) =>
                        r.worktrees.some((w) => w.id === selectedProjectId)
                      )?.name ?? 'Current project'}
                    </span>
                  </>
                )}
              </>
            )}
          </div>
          <Button
            variant={globalSearchEnabled ? 'secondary' : 'ghost'}
            size="xs"
            onClick={() => setGlobalSearchEnabled(!globalSearchEnabled)}
            className={
              globalSearchEnabled ? 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30' : ''
            }
            title={
              !globalSearchEnabled
                ? `Search across all projects (${formatModifierShortcut('G')})`
                : undefined
            }
          >
            <Globe className="size-3" />
            Global
          </Button>
        </div>

        <div className="border-border flex items-center gap-3 border-b px-4 py-3">
          <Search className="text-muted-foreground size-5 shrink-0" />
          <CommandPrimitive.Input
            value={query}
            onValueChange={setQuery}
            placeholder={
              searchMode === 'projects' ? 'Search projects...' : 'Search conversations...'
            }
            className="placeholder:text-muted-foreground/50 text-foreground flex-1 bg-transparent text-base outline-hidden"
            onKeyDown={(e) => {
              if (e.key === 'g' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                setGlobalSearchEnabled((prev) => !prev);
              }
            }}
          />
          {loading && <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />}
          <Button variant="ghost" size="icon-xs" onClick={closeCommandPalette} title="Close" aria-label="Close search palette">
            <X className="size-4" />
          </Button>
        </div>

        <CommandList className="max-h-[50vh]">
          {searchMode === 'projects' ? (
            <CommandGroup heading="Projects">
              {filteredProjects.map((repo) => (
                <CommandItem
                  key={repo.id}
                  value={repo.id}
                  onSelect={() => handleProjectSelect(repo.id)}
                  className="gap-3 px-4 py-3"
                >
                  <FolderGit2 className="text-muted-foreground size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-foreground truncate text-sm font-medium">{repo.name}</div>
                    <div className="text-muted-foreground mt-0.5 truncate font-mono text-xs">
                      {repo.worktrees[0]?.path || ''}
                    </div>
                    <div className="text-muted-foreground mt-1 flex items-center gap-3 text-xs">
                      <span>{repo.totalSessions} sessions</span>
                      <span>·</span>
                      <span>
                        {repo.mostRecentSession
                          ? formatDistanceToNow(new Date(repo.mostRecentSession), {
                              addSuffix: true,
                            })
                          : 'No recent activity'}
                      </span>
                    </div>
                  </div>
                </CommandItem>
              ))}
              {filteredProjects.length === 0 && (
                <CommandEmpty>
                  {query.trim() ? `No projects found for "${query}"` : 'No projects found'}
                </CommandEmpty>
              )}
            </CommandGroup>
          ) : query.trim().length < 2 ? (
            <CommandEmpty>Type at least 2 characters to search</CommandEmpty>
          ) : sessionResults.length === 0 && !loading ? (
            <CommandEmpty>
              {searchIsPartial
                ? `No fast results in recent sessions for "${query}"`
                : `No results found for "${query}"`}
            </CommandEmpty>
          ) : (
            <CommandGroup heading="Results">
              {sessionResults.map((result, index) => {
                const projectName = globalSearchEnabled
                  ? repositoryGroups.find((r) => r.worktrees.some((w) => w.id === result.projectId))
                      ?.name
                  : undefined;

                return (
                  <CommandItem
                    key={`${result.sessionId}-${index}`}
                    value={`${result.sessionId}-${index}`}
                    onSelect={() => handleSessionSelect(result)}
                    className="gap-3 px-4 py-3"
                  >
                    <div
                      className={cn(
                        'shrink-0',
                        result.messageType === 'user' ? 'text-blue-400' : 'text-green-400'
                      )}
                    >
                      {result.messageType === 'user' ? (
                        <User className="size-4" />
                      ) : (
                        <Bot className="size-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      {globalSearchEnabled && projectName && (
                        <div className="mb-1 flex items-center gap-2">
                          <FolderGit2 className="size-3 text-blue-400" />
                          <span className="truncate text-xs font-medium text-blue-400">
                            {projectName}
                          </span>
                        </div>
                      )}
                      <div className="mb-1 flex items-center gap-2">
                        <FileText className="text-muted-foreground size-3" />
                        <span className="text-muted-foreground truncate text-xs">
                          {result.sessionTitle.slice(0, 60)}
                          {result.sessionTitle.length > 60 ? '...' : ''}
                        </span>
                      </div>
                      <div className="text-foreground text-sm leading-relaxed">
                        {highlightMatch(result.context, result.matchedText)}
                      </div>
                      <div className="text-muted-foreground/60 mt-1 text-xs">
                        {new Date(result.timestamp).toLocaleDateString()}{' '}
                        {new Date(result.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}
          {/* Export actions (when a session is loaded) */}
          {sessionDetail && query.trim() === '' && (
            <CommandGroup heading="Export Session">
              <CommandItem
                onSelect={() => {
                  triggerDownload(sessionDetail, 'markdown');
                  closeCommandPalette();
                }}
              >
                <Download className="mr-2 size-4" />
                Export as Markdown
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  triggerDownload(sessionDetail, 'json');
                  closeCommandPalette();
                }}
              >
                <Download className="mr-2 size-4" />
                Export as JSON
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  triggerDownload(sessionDetail, 'plaintext');
                  closeCommandPalette();
                }}
              >
                <Download className="mr-2 size-4" />
                Export as Plain Text
              </CommandItem>
            </CommandGroup>
          )}
        </CommandList>

        <CommandSeparator />

        <div className="text-muted-foreground flex items-center justify-between px-4 py-2 text-xs">
          <span>
            {searchMode === 'projects'
              ? `${filteredProjects.length} project${filteredProjects.length !== 1 ? 's' : ''}`
              : totalMatches > 0
                ? `${totalMatches} ${searchIsPartial ? 'fast ' : ''}result${totalMatches !== 1 ? 's' : ''}${globalSearchEnabled ? ' across all projects' : ''}`
                : 'Type to search'}
          </span>
          <div className="flex items-center gap-4">
            <span>
              <kbd className="bg-popover rounded px-1.5 py-0.5 text-[10px]">↑↓</kbd> navigate
            </span>
            <span>
              <kbd className="bg-popover rounded px-1.5 py-0.5 text-[10px]">↵</kbd>{' '}
              {searchMode === 'projects' ? 'select' : 'open'}
            </span>
            <span>
              <kbd className="bg-popover rounded px-1.5 py-0.5 text-[10px]">
                {formatModifierShortcut('G')}
              </kbd>{' '}
              global
            </span>
            <span>
              <kbd className="bg-popover rounded px-1.5 py-0.5 text-[10px]">esc</kbd> close
            </span>
          </div>
        </div>
      </Command>
    </CommandDialog>
  );
};
