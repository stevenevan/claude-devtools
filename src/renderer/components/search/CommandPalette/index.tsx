import React from 'react';

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
import { formatModifierShortcut } from '@renderer/utils/keyboardUtils';
import { triggerDownload } from '@renderer/utils/sessionExporter';
import { Command as CommandPrimitive } from 'cmdk';
import {
  Copy,
  Download,
  FolderGit2,
  Globe,
  HelpCircle,
  Loader2,
  MessageSquare,
  Search,
  X,
} from 'lucide-react';

import { ProjectResults } from './ProjectResults';
import { SessionResults } from './SessionResults';
import { useCommandPaletteSearch } from './useCommandPaletteSearch';

export const CommandPalette = (): React.JSX.Element | null => {
  const {
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
  } = useCommandPaletteSearch();

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
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={closeCommandPalette}
            title="Close"
            aria-label="Close search palette"
          >
            <X className="size-4" />
          </Button>
        </div>

        <CommandList className="max-h-[50vh]">
          {searchMode === 'projects' ? (
            <ProjectResults
              projects={filteredProjects}
              query={query}
              onSelect={handleProjectSelect}
            />
          ) : query.trim().length < 2 ? (
            <CommandEmpty>Type at least 2 characters to search</CommandEmpty>
          ) : sessionResults.length === 0 && !loading ? (
            <CommandEmpty>
              {searchIsPartial
                ? `No fast results in recent sessions for "${query}"`
                : `No results found for "${query}"`}
            </CommandEmpty>
          ) : (
            <SessionResults
              results={sessionResults}
              globalSearchEnabled={globalSearchEnabled}
              repositoryGroups={repositoryGroups}
              onSelect={handleSessionSelect}
            />
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
              {sessionDetail.session?.id && (
                <CommandItem
                  onSelect={() => {
                    const id = sessionDetail.session.id;
                    void navigator.clipboard.writeText(id);
                    closeCommandPalette();
                  }}
                >
                  <Copy className="mr-2 size-4" />
                  Copy Session ID
                </CommandItem>
              )}
            </CommandGroup>
          )}

          {query.trim() === '' && (
            <CommandGroup heading="Quick Actions">
              <CommandItem
                onSelect={() => {
                  setHelpPanelOpen(true);
                  closeCommandPalette();
                }}
              >
                <HelpCircle className="mr-2 size-4" />
                Show Help
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
