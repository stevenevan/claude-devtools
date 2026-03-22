/**
 * SidebarHeader - Linear-style header with project name and worktree selector.
 *
 * Layout (2 stacked horizontal bars):
 * - Row 1: Project name (left-aligned after macOS traffic lights)
 * - Row 2: Worktree selector (full-width button)
 *
 * Visual requirements:
 * - Row 1 is the drag region for window movement
 * - Row 1 reserves left space for macOS traffic lights via shared layout CSS variable
 * - Row 2 is a full-width button with no side margins
 */

import { useEffect, useRef, useState } from 'react';

import { isDesktopMode } from '@renderer/api';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { formatShortcut, truncateMiddle } from '@renderer/utils/stringUtils';
import { Check, ChevronDown, GitBranch, PanelLeft } from 'lucide-react';
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
  // Find main worktree
  const mainWorktree = worktrees.find((w) => w.isMainWorktree) ?? null;

  // Group remaining worktrees by source
  const groupMap = new Map<WorktreeSource, Worktree[]>();

  for (const wt of worktrees) {
    if (wt.isMainWorktree) continue; // Skip main, handled separately

    const existing = groupMap.get(wt.source) ?? [];
    existing.push(wt);
    groupMap.set(wt.source, existing);
  }

  // Convert to array and sort each group internally by most recent
  const groups: WorktreeGroup[] = [];

  for (const [source, wts] of groupMap) {
    // Sort worktrees within group by most recent
    const sorted = [...wts].sort((a, b) => (b.mostRecentSession ?? 0) - (a.mostRecentSession ?? 0));

    const mostRecent = Math.max(...sorted.map((w) => w.mostRecentSession ?? 0));

    groups.push({
      source,
      label: SOURCE_LABELS[source] ?? source,
      worktrees: sorted,
      mostRecent,
    });
  }

  // Sort groups by most recent activity
  groups.sort((a, b) => b.mostRecent - a.mostRecent);

  return { mainWorktree, groups };
}

/**
 * Individual worktree item in the dropdown.
 */
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
  const [isHovered, setIsHovered] = useState(false);

  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        'flex w-full items-center gap-1.5 px-4 py-1.5 text-left transition-colors',
        isSelected ? 'bg-surface-raised text-text' : isHovered ? 'bg-surface-raised opacity-50' : ''
      )}
    >
      <GitBranch
        className={cn('size-3.5 shrink-0', isSelected ? 'text-emerald-400' : 'text-text-muted')}
      />
      {/* Only show badge for main worktree - others are grouped by header */}
      {worktree.isMainWorktree && <WorktreeBadge source={worktree.source} isMain />}
      <span
        className={cn(
          'flex-1 truncate font-mono text-xs',
          isSelected ? 'text-text' : 'text-text-muted'
        )}
      >
        {truncateMiddle(worktree.name, 28)}
      </span>
      <span className="text-text-muted shrink-0 text-[10px]">{worktree.sessions.length}</span>
      {isSelected && <Check className="size-3.5 shrink-0 text-indigo-400" />}
    </button>
  );
};

/**
 * Individual project/repository item in the dropdown.
 */
interface ProjectDropdownItemProps {
  name: string;
  path?: string;
  sessionCount: number;
  isSelected: boolean;
  onSelect: () => void;
}

const ProjectDropdownItem = ({
  name,
  path,
  sessionCount,
  isSelected,
  onSelect,
}: Readonly<ProjectDropdownItemProps>): React.JSX.Element => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors',
        isSelected ? 'bg-surface-raised text-text' : isHovered ? 'bg-surface-raised opacity-50' : ''
      )}
    >
      <div className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate text-sm',
            isSelected ? 'font-medium text-text' : 'text-text-muted'
          )}
        >
          {name}
        </span>
        {path && <span className="text-text-muted block truncate text-[10px]">{path}</span>}
      </div>
      <span className="text-text-muted shrink-0 text-[10px]">{sessionCount}</span>
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
    selectRepository,
    viewMode,
    projects,
    activeProjectId,
    setActiveProject,
    fetchRepositoryGroups,
    fetchProjects,
    toggleSidebar,
  } = useStore(
    useShallow((s) => ({
      repositoryGroups: s.repositoryGroups,
      selectedRepositoryId: s.selectedRepositoryId,
      selectedWorktreeId: s.selectedWorktreeId,
      selectWorktree: s.selectWorktree,
      selectRepository: s.selectRepository,
      viewMode: s.viewMode,
      projects: s.projects,
      activeProjectId: s.activeProjectId,
      setActiveProject: s.setActiveProject,
      fetchRepositoryGroups: s.fetchRepositoryGroups,
      fetchProjects: s.fetchProjects,
      toggleSidebar: s.toggleSidebar,
    }))
  );

  // Fetch data on mount based on view mode
  useEffect(() => {
    if (viewMode === 'grouped' && repositoryGroups.length === 0) {
      void fetchRepositoryGroups();
    } else if (viewMode === 'flat' && projects.length === 0) {
      void fetchProjects();
    }
  }, [viewMode, repositoryGroups.length, projects.length, fetchRepositoryGroups, fetchProjects]);

  const [isWorktreeDropdownOpen, setIsWorktreeDropdownOpen] = useState(false);
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const worktreeDropdownRef = useRef<HTMLDivElement>(null);
  const projectDropdownRef = useRef<HTMLDivElement>(null);

  // Find the active repository and worktree
  const activeRepo = repositoryGroups.find((r) => r.id === selectedRepositoryId);
  const activeWorktree = activeRepo?.worktrees.find((w) => w.id === selectedWorktreeId);
  // Filter worktrees to only show those with sessions
  const worktrees = (activeRepo?.worktrees ?? []).filter((w) => w.sessions.length > 0);
  const hasMultipleWorktrees = worktrees.length > 1;

  // Group worktrees by source for organized dropdown
  const worktreeGroupingResult = groupWorktreesBySource(worktrees);
  const mainWorktree = worktreeGroupingResult.mainWorktree;
  const worktreeGroups = worktreeGroupingResult.groups;

  // For flat mode
  const activeProject = projects.find((p) => p.id === activeProjectId);

  // Get display name
  const projectName =
    viewMode === 'grouped'
      ? (activeRepo?.name ?? 'Select Project')
      : (activeProject?.name ?? 'Select Project');

  const worktreeName = activeWorktree?.name ?? 'main';
  const hasSelection = viewMode === 'grouped' ? !!activeRepo : !!activeProject;

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (
        worktreeDropdownRef.current &&
        !worktreeDropdownRef.current.contains(event.target as Node)
      ) {
        setIsWorktreeDropdownOpen(false);
      }
      if (
        projectDropdownRef.current &&
        !projectDropdownRef.current.contains(event.target as Node)
      ) {
        setIsProjectDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close on escape
  useEffect(() => {
    function handleEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setIsWorktreeDropdownOpen(false);
        setIsProjectDropdownOpen(false);
      }
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  const handleSelectWorktree = (worktree: Worktree): void => {
    selectWorktree(worktree.id);
    setIsWorktreeDropdownOpen(false);
  };

  const handleSelectRepo = (repoId: string): void => {
    selectRepository(repoId);
    setIsProjectDropdownOpen(false);
  };

  const handleSelectProject = (projectId: string): void => {
    setActiveProject(projectId);
    setIsProjectDropdownOpen(false);
  };

  // Items for project dropdown - filter out repositories/projects with 0 sessions
  const projectItems =
    viewMode === 'grouped'
      ? repositoryGroups.filter((r) => r.totalSessions > 0)
      : projects.filter((p) => p.sessions.length > 0);

  const [isCollapseHovered, setIsCollapseHovered] = useState(false);

  return (
    <div className="bg-surface-sidebar flex w-full flex-col">
      {/* ROW 1: Project Identity (Title Bar / Drag Region) */}
      <div
        ref={projectDropdownRef}
        className={cn(
          'relative flex h-10 items-center gap-2 pr-2 select-none',
          isMacElectron ? 'pl-[var(--macos-traffic-light-padding-left,72px)]' : 'pl-4'
        )}
        style={isMacElectron ? { WebkitAppRegion: 'drag' } as React.CSSProperties : undefined}
      >
        {/* Project name dropdown button */}
        <button
          onClick={() => setIsProjectDropdownOpen(!isProjectDropdownOpen)}
          className="flex min-w-0 items-center gap-2 transition-opacity hover:opacity-80"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <span
            className={cn(
              'min-w-0 truncate text-sm font-bold tracking-tight',
              hasSelection ? 'text-text' : 'text-text-muted'
            )}
          >
            {projectName}
          </span>
          <ChevronDown
            className={cn(
              'size-3.5 shrink-0 transition-transform text-text-muted',
              isProjectDropdownOpen ? 'rotate-180' : ''
            )}
          />
        </button>

        {/* Collapse sidebar button */}
        <button
          onClick={toggleSidebar}
          onMouseEnter={() => setIsCollapseHovered(true)}
          onMouseLeave={() => setIsCollapseHovered(false)}
          className={cn(
            'ml-auto shrink-0 rounded-md p-1.5 transition-colors',
            isCollapseHovered ? 'text-text-secondary bg-surface-raised' : 'text-text-muted'
          )}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title={`Collapse sidebar (${formatShortcut('B')})`}
        >
          <PanelLeft className="size-4" />
        </button>

        {/* Project Dropdown */}
        {isProjectDropdownOpen && (
          <>
            <div
              role="presentation"
              className="fixed inset-0 z-10"
              onClick={() => setIsProjectDropdownOpen(false)}
            />
            <div className="border-border bg-surface-sidebar absolute inset-x-4 top-full z-20 mt-1 max-h-[350px] overflow-y-auto rounded-lg border py-1 shadow-xl">
              <div className="text-text-muted px-3 py-2 text-[10px] font-semibold tracking-wider uppercase">
                Switch {viewMode === 'grouped' ? 'Repository' : 'Project'}
              </div>

              {projectItems.length === 0 ? (
                <div className="text-text-muted p-3 text-sm">
                  No {viewMode === 'grouped' ? 'repositories' : 'projects'} found
                </div>
              ) : (
                projectItems.map((item) => {
                  const isSelected =
                    viewMode === 'grouped'
                      ? item.id === selectedRepositoryId
                      : item.id === activeProjectId;
                  const itemSessions =
                    viewMode === 'grouped'
                      ? (item as (typeof repositoryGroups)[0]).totalSessions
                      : (item as (typeof projects)[0]).sessions.length;
                  // Get path for display
                  const itemPath =
                    viewMode === 'grouped'
                      ? (item as (typeof repositoryGroups)[0]).worktrees[0]?.path
                      : (item as (typeof projects)[0]).path;

                  return (
                    <ProjectDropdownItem
                      key={item.id}
                      name={item.name}
                      path={itemPath}
                      sessionCount={itemSessions}
                      isSelected={isSelected}
                      onSelect={() =>
                        viewMode === 'grouped'
                          ? handleSelectRepo(item.id)
                          : handleSelectProject(item.id)
                      }
                    />
                  );
                })
              )}
            </div>
          </>
        )}
      </div>

      {/* ROW 2: Worktree Selector (Full Width) */}
      {viewMode === 'grouped' && activeRepo && (
        <div ref={worktreeDropdownRef} className="relative w-full">
          <button
            onClick={() =>
              hasMultipleWorktrees && setIsWorktreeDropdownOpen(!isWorktreeDropdownOpen)
            }
            disabled={!hasMultipleWorktrees}
            className={cn(
              'flex h-[30px] w-full items-center justify-between px-4 text-left transition-colors',
              hasMultipleWorktrees ? 'cursor-pointer' : 'cursor-default',
              isWorktreeDropdownOpen
                ? 'bg-surface-raised text-text'
                : 'bg-surface-sidebar text-text-muted'
            )}
          >
            <div className="flex flex-1 items-center gap-1.5 overflow-hidden">
              <GitBranch
                className={cn(
                  'size-4 shrink-0',
                  isWorktreeDropdownOpen ? 'text-[var(--worktree-icon)]' : 'text-[var(--worktree-icon-muted)]'
                )}
              />
              {activeWorktree?.isMainWorktree ? (
                <WorktreeBadge source={activeWorktree.source} isMain />
              ) : (
                activeWorktree?.source && <WorktreeBadge source={activeWorktree.source} />
              )}
              <span className="truncate font-mono text-xs">{truncateMiddle(worktreeName, 28)}</span>
            </div>
            {hasMultipleWorktrees && (
              <ChevronDown
                className={cn(
                  'size-4 shrink-0 transition-transform text-text-muted',
                  isWorktreeDropdownOpen ? 'rotate-180' : ''
                )}
              />
            )}
          </button>

          {/* Worktree Dropdown */}
          {isWorktreeDropdownOpen && hasMultipleWorktrees && (
            <>
              <div
                role="presentation"
                className="fixed inset-0 z-10"
                onClick={() => setIsWorktreeDropdownOpen(false)}
              />
              <div className="border-border bg-surface-sidebar absolute inset-x-0 top-full z-20 mt-0 max-h-[400px] overflow-y-auto border border-t-0 py-1 shadow-xl">
                <div className="text-text-muted px-4 py-2 text-[10px] font-semibold tracking-wider uppercase">
                  Switch Worktree
                </div>

                {/* Main worktree first */}
                {mainWorktree && (
                  <WorktreeItem
                    worktree={mainWorktree}
                    isSelected={mainWorktree.id === selectedWorktreeId}
                    onSelect={() => handleSelectWorktree(mainWorktree)}
                  />
                )}

                {/* Grouped worktrees by source */}
                {worktreeGroups.map((group) => (
                  <div key={group.source}>
                    {/* Group header */}
                    <div className="border-border text-text-muted mt-1 border-t px-4 py-1.5 text-[9px] font-medium tracking-wider uppercase">
                      {group.label}
                    </div>
                    {/* Worktrees in group */}
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
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
