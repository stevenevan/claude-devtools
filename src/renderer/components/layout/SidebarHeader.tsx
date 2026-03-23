/**
 * SidebarHeader - Shows "Projects" title or project name with back button.
 *
 * Layout:
 * - No project selected: "Projects" title + collapse button
 * - Project selected: Back button + project name + collapse button, optional worktree selector
 *
 * Visual requirements:
 * - Row 1 is the drag region for window movement
 * - Row 1 reserves left space for macOS traffic lights via shared layout CSS variable
 */

import { useEffect, useState } from 'react';

import { isDesktopMode } from '@renderer/api';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { formatShortcut, truncateMiddle } from '@renderer/utils/stringUtils';
import { Check, ChevronDown, ChevronLeft, GitBranch, PanelLeft } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { WorktreeBadge } from '../common/WorktreeBadge';

import type { Worktree, WorktreeSource } from '@renderer/types/data';

/**
 * Group worktrees by source for organized dropdown display.
 * Returns: main worktree first, then groups sorted by most recent activity.
 */
interface WorktreeGroup {
  source: WorktreeSource;
  label: string;
  worktrees: Worktree[];
  mostRecent: number;
}

const SOURCE_LABELS: Record<WorktreeSource, string> = {
  'vibe-kanban': 'Vibe Kanban',
  conductor: 'Conductor',
  'auto-claude': 'Auto Claude',
  '21st': '21st',
  'claude-desktop': 'Claude Desktop',
  ccswitch: 'ccswitch',
  git: 'Git',
  unknown: 'Other',
};

function groupWorktreesBySource(worktrees: Worktree[]): {
  mainWorktree: Worktree | null;
  groups: WorktreeGroup[];
} {
  const mainWorktree = worktrees.find((w) => w.isMainWorktree) ?? null;
  const groupMap = new Map<WorktreeSource, Worktree[]>();

  for (const wt of worktrees) {
    if (wt.isMainWorktree) continue;
    const existing = groupMap.get(wt.source) ?? [];
    existing.push(wt);
    groupMap.set(wt.source, existing);
  }

  const groups: WorktreeGroup[] = [];

  for (const [source, wts] of groupMap) {
    const sorted = [...wts].sort((a, b) => (b.mostRecentSession ?? 0) - (a.mostRecentSession ?? 0));
    const mostRecent = Math.max(...sorted.map((w) => w.mostRecentSession ?? 0));
    groups.push({
      source,
      label: SOURCE_LABELS[source] ?? source,
      worktrees: sorted,
      mostRecent,
    });
  }

  groups.sort((a, b) => b.mostRecent - a.mostRecent);
  return { mainWorktree, groups };
}

interface WorktreeItemProps {
  worktree: Worktree;
  isSelected: boolean;
  onSelect: () => void;
}

const WorktreeItem = ({
  worktree,
  isSelected,
  onSelect,
}: Readonly<WorktreeItemProps>): React.JSX.Element => {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-1.5 px-3 py-2 text-left transition-colors',
        isSelected ? 'bg-card text-foreground' : 'hover:bg-card'
      )}
    >
      <GitBranch
        className={cn(
          'size-3.5 shrink-0',
          isSelected ? 'text-emerald-400' : 'text-muted-foreground'
        )}
      />
      {worktree.isMainWorktree && <WorktreeBadge source={worktree.source} isMain />}
      <span
        className={cn(
          'flex-1 truncate font-mono text-xs',
          isSelected ? 'text-foreground' : 'text-muted-foreground'
        )}
      >
        {truncateMiddle(worktree.name, 28)}
      </span>
      <span className="text-muted-foreground shrink-0 text-[10px]">{worktree.sessions.length}</span>
      {isSelected && <Check className="size-3.5 shrink-0 text-indigo-400" />}
    </button>
  );
};

export const SidebarHeader = (): React.JSX.Element => {
  const isMacElectron = isDesktopMode() && window.navigator.userAgent.toLowerCase().includes('mac');

  const {
    repositoryGroups,
    selectedRepositoryId,
    selectedWorktreeId,
    selectWorktree,
    viewMode,
    projects,
    activeProjectId,
    clearActiveProject,
    fetchRepositoryGroups,
    fetchProjects,
    toggleSidebar,
  } = useStore(
    useShallow((s) => ({
      repositoryGroups: s.repositoryGroups,
      selectedRepositoryId: s.selectedRepositoryId,
      selectedWorktreeId: s.selectedWorktreeId,
      selectWorktree: s.selectWorktree,
      viewMode: s.viewMode,
      projects: s.projects,
      activeProjectId: s.activeProjectId,
      clearActiveProject: s.clearActiveProject,
      fetchRepositoryGroups: s.fetchRepositoryGroups,
      fetchProjects: s.fetchProjects,
      toggleSidebar: s.toggleSidebar,
    }))
  );

  useEffect(() => {
    if (viewMode === 'grouped' && repositoryGroups.length === 0) {
      void fetchRepositoryGroups();
    } else if (viewMode === 'flat' && projects.length === 0) {
      void fetchProjects();
    }
  }, [viewMode, repositoryGroups.length, projects.length, fetchRepositoryGroups, fetchProjects]);

  const [isWorktreeDropdownOpen, setIsWorktreeDropdownOpen] = useState(false);

  const activeRepo = repositoryGroups.find((r) => r.id === selectedRepositoryId);
  const activeWorktree = activeRepo?.worktrees.find((w) => w.id === selectedWorktreeId);
  const worktrees = (activeRepo?.worktrees ?? []).filter((w) => w.sessions.length > 0);
  const hasMultipleWorktrees = worktrees.length > 1;

  const worktreeGroupingResult = groupWorktreesBySource(worktrees);
  const mainWorktree = worktreeGroupingResult.mainWorktree;
  const worktreeGroups = worktreeGroupingResult.groups;

  const activeProject = projects.find((p) => p.id === activeProjectId);

  const projectName =
    viewMode === 'grouped' ? activeRepo?.name : activeProject?.name;

  const worktreeName = activeWorktree?.name ?? 'main';
  const hasProject = !!activeProjectId;

  const handleSelectWorktree = (worktree: Worktree): void => {
    selectWorktree(worktree.id);
    setIsWorktreeDropdownOpen(false);
  };

  return (
    <div className="bg-sidebar flex w-full flex-col">
      {/* ROW 1: Title Bar / Drag Region */}
      <div
        className={cn(
          'relative flex items-center gap-1 pr-2 select-none',
          isMacElectron ? 'h-12' : 'h-10',
          isMacElectron ? 'pl-[var(--macos-traffic-light-padding-left,72px)]' : 'pl-2'
        )}
        data-tauri-drag-region
        style={isMacElectron ? ({ WebkitAppRegion: 'drag' } as React.CSSProperties) : undefined}
      >
        {hasProject ? (
          <>
            <button
              onClick={clearActiveProject}
              className="text-muted-foreground hover:text-foreground hover:bg-card shrink-0 rounded-md p-1.5 transition-colors"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              title="Back to projects"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-foreground min-w-0 truncate text-sm font-bold tracking-tight">
              {projectName}
            </span>
          </>
        ) : (
          <span
            className={cn(
              'text-muted-foreground min-w-0 truncate text-sm font-bold tracking-tight',
              !isMacElectron && 'pl-2'
            )}
          >
            Projects
          </span>
        )}

        {/* Collapse sidebar button */}
        <button
          onClick={toggleSidebar}
          className="text-muted-foreground hover:text-foreground hover:bg-card ml-auto shrink-0 rounded-md p-1.5 transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title={`Collapse sidebar (${formatShortcut('B')})`}
        >
          <PanelLeft className="size-4" />
        </button>
      </div>

      {/* ROW 2: Worktree Selector (Full Width) - only when project is selected */}
      {hasProject && viewMode === 'grouped' && activeRepo && (
        <div className="relative w-full">
          <Popover open={isWorktreeDropdownOpen} onOpenChange={setIsWorktreeDropdownOpen}>
            <PopoverTrigger
              disabled={!hasMultipleWorktrees}
              className={cn(
                'flex h-[30px] w-full items-center justify-between px-4 text-left transition-colors',
                hasMultipleWorktrees ? 'cursor-pointer' : 'cursor-default',
                isWorktreeDropdownOpen
                  ? 'bg-card text-foreground'
                  : 'bg-sidebar text-muted-foreground'
              )}
            >
              <div className="flex flex-1 items-center gap-1.5 overflow-hidden">
                <GitBranch
                  className={cn(
                    'size-4 shrink-0',
                    isWorktreeDropdownOpen ? 'text-emerald-400' : 'text-emerald-400/70'
                  )}
                />
                {activeWorktree?.isMainWorktree ? (
                  <WorktreeBadge source={activeWorktree.source} isMain />
                ) : (
                  activeWorktree?.source && <WorktreeBadge source={activeWorktree.source} />
                )}
                <span className="truncate font-mono text-xs">
                  {truncateMiddle(worktreeName, 28)}
                </span>
              </div>
              {hasMultipleWorktrees && (
                <ChevronDown
                  className={cn(
                    'size-4 shrink-0 transition-transform text-muted-foreground',
                    isWorktreeDropdownOpen && 'rotate-180'
                  )}
                />
              )}
            </PopoverTrigger>
            <PopoverContent
              side="bottom"
              sideOffset={0}
              align="start"
              className="bg-sidebar max-h-[400px] w-[var(--anchor-width)] overflow-y-auto border-t-0 p-0 py-1"
            >
              <div className="text-muted-foreground px-4 py-2 text-[10px] font-semibold tracking-wider uppercase">
                Switch Worktree
              </div>
              {mainWorktree && (
                <WorktreeItem
                  worktree={mainWorktree}
                  isSelected={mainWorktree.id === selectedWorktreeId}
                  onSelect={() => handleSelectWorktree(mainWorktree)}
                />
              )}
              {worktreeGroups.map((group) => (
                <div key={group.source}>
                  <div className="border-border text-muted-foreground mt-1 border-t px-4 py-1.5 text-[9px] font-medium tracking-wider uppercase">
                    {group.label}
                  </div>
                  {group.worktrees.map((worktree) => (
                    <WorktreeItem
                      key={worktree.id}
                      worktree={worktree}
                      isSelected={worktree.id === selectedWorktreeId}
                      onSelect={() => handleSelectWorktree(worktree)}
                    />
                  ))}
                </div>
              ))}
            </PopoverContent>
          </Popover>
        </div>
      )}
    </div>
  );
};
