/**
 * DashboardView - Main dashboard with "Productivity Luxury" aesthetic.
 * Inspired by Linear, Vercel, and Raycast design patterns.
 * Features:
 * - Subtle spotlight gradient
 * - Centralized command search with inline project filtering
 * - Border-first project cards with minimal backgrounds
 */

import React, { useEffect, useMemo, useState } from 'react';

import { api } from '@renderer/api';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { formatShortcut } from '@renderer/utils/stringUtils';
import { createLogger } from '@shared/utils/logger';
import { useShallow } from 'zustand/react/shallow';

const logger = createLogger('Component:DashboardView');
import { Button } from '@renderer/components/ui/button';
import { Skeleton } from '@renderer/components/ui/skeleton';
import { formatDistanceToNow } from 'date-fns';
import { Command, FolderGit2, FolderOpen, GitBranch, Search, Settings } from 'lucide-react';

import type { RepositoryGroup } from '@renderer/types/data';

// Command Search Input

interface CommandSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

const CommandSearch = ({
  value,
  onChange,
  placeholder = 'Search projects...',
}: Readonly<CommandSearchProps>): React.JSX.Element => {
  const [isFocused, setIsFocused] = useState(false);
  const { openCommandPalette, selectedProjectId } = useStore(
    useShallow((s) => ({
      openCommandPalette: s.openCommandPalette,
      selectedProjectId: s.selectedProjectId,
    }))
  );

  // Handle Cmd+K to open full command palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        openCommandPalette();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openCommandPalette]);

  return (
    <div className="relative mx-auto w-full max-w-xl">
      {/* Search container with glow effect on focus */}
      <div
        className={cn(
          'bg-card relative flex items-center gap-3 rounded-xs border px-4 py-3 transition-all duration-200',
          isFocused
            ? 'border-zinc-500 shadow-[0_0_20px_rgba(255,255,255,0.04)] ring-1 ring-zinc-600/30'
            : 'border-border hover:border-zinc-600'
        )}
      >
        <Search className="text-muted-foreground size-4 shrink-0" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="text-foreground placeholder:text-muted-foreground flex-1 bg-transparent text-sm outline-hidden"
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
        />
        {/* Keyboard shortcut badge - opens full command palette */}
        <button
          onClick={() => openCommandPalette()}
          className="flex shrink-0 items-center gap-1 transition-opacity hover:opacity-80"
          title={
            selectedProjectId
              ? `Search in sessions (${formatShortcut('K')})`
              : `Search projects (${formatShortcut('K')})`
          }
        >
          <kbd className="border-border bg-popover text-muted-foreground flex h-5 items-center justify-center rounded-sm border px-1.5 text-[10px] font-medium">
            <Command className="size-2.5" />
          </kbd>
          <kbd className="border-border bg-popover text-muted-foreground flex size-5 items-center justify-center rounded-sm border text-[10px] font-medium">
            K
          </kbd>
        </button>
      </div>
    </div>
  );
};

// Repository Card

interface RepositoryCardProps {
  repo: RepositoryGroup;
  onClick: () => void;
  isHighlighted?: boolean;
}

/**
 * Truncate path to show ~/relative/path format
 */
function formatProjectPath(path: string): string {
  const p = path.replace(/\\/g, '/');

  if (p.startsWith('/Users/') || p.startsWith('/home/')) {
    const parts = p.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const rest = parts.slice(2).join('/');
      return rest ? `~/${rest}` : '~';
    }
  }

  if (isWindowsUserPath(path)) {
    const parts = p.split('/').filter(Boolean);
    if (parts.length >= 3) {
      const rest = parts.slice(3).join('/');
      return rest ? `~/${rest}` : '~';
    }
  }

  return p;
}

function isWindowsUserPath(input: string): boolean {
  if (input.length < 10) {
    return false;
  }

  const drive = input.charCodeAt(0);
  const hasDriveLetter =
    ((drive >= 65 && drive <= 90) || (drive >= 97 && drive <= 122)) && input[1] === ':';

  return hasDriveLetter && input.startsWith('\\Users\\', 2);
}

const RepositoryCard = ({
  repo,
  onClick,
  isHighlighted,
}: Readonly<RepositoryCardProps>): React.JSX.Element => {
  const lastActivity = repo.mostRecentSession
    ? formatDistanceToNow(new Date(repo.mostRecentSession), { addSuffix: true })
    : 'No recent activity';

  const worktreeCount = repo.worktrees.length;
  const hasMultipleWorktrees = worktreeCount > 1;

  // Get the path from the first worktree
  const projectPath = repo.worktrees[0]?.path || '';
  const formattedPath = formatProjectPath(projectPath);

  return (
    <button
      onClick={onClick}
      className={cn(
        'group relative flex min-h-[120px] flex-col overflow-hidden rounded-xs border p-4 text-left transition-all duration-300',
        isHighlighted ? 'border-border bg-card' : 'bg-background/50 border-border hover:bg-card'
      )}
    >
      {/* Icon with subtle border */}
      <div className="border-border bg-popover mb-3 flex size-8 items-center justify-center rounded-xs border transition-colors duration-300">
        <FolderGit2 className="text-muted-foreground group-hover:text-foreground size-4 transition-colors" />
      </div>

      {/* Project name */}
      <h3 className="text-foreground mb-1 truncate text-sm font-medium transition-colors duration-200">
        {repo.name}
      </h3>

      {/* Project path - monospace, muted */}
      <p className="text-muted-foreground mb-auto truncate font-mono text-[10px]">
        {formattedPath}
      </p>

      {/* Meta row: worktrees, sessions, time */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {hasMultipleWorktrees && (
          <span className="text-muted-foreground inline-flex items-center gap-1 text-[10px]">
            <GitBranch className="size-3" />
            {worktreeCount} worktrees
          </span>
        )}
        <span className="text-muted-foreground text-[10px]">{repo.totalSessions} sessions</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground text-[10px]">{lastActivity}</span>
      </div>
    </button>
  );
};

// Ghost Card (New Project)

const NewProjectCard = (): React.JSX.Element => {
  const { repositoryGroups, selectRepository } = useStore(
    useShallow((s) => ({
      repositoryGroups: s.repositoryGroups,
      selectRepository: s.selectRepository,
    }))
  );

  const handleClick = async (): Promise<void> => {
    try {
      const selectedPaths = await api.config.selectFolders();
      if (!selectedPaths || selectedPaths.length === 0) {
        return; // User cancelled
      }

      const selectedPath = selectedPaths[0];

      // Match selected path against known repository worktrees
      for (const repo of repositoryGroups) {
        for (const worktree of repo.worktrees) {
          if (worktree.path === selectedPath) {
            selectRepository(repo.id);
            return;
          }
        }
      }

      // No match found - open the folder in file manager as fallback
      const result = await api.openPath(selectedPath);
      if (!result.success) {
        logger.error('Failed to open folder:', result.error);
      }
    } catch (error) {
      logger.error('Error selecting folder:', error);
    }
  };

  return (
    <button
      className="hover:bg-background/30 group border-border relative flex min-h-[120px] flex-col items-center justify-center rounded-xs border border-dashed bg-transparent p-4 transition-all duration-300"
      onClick={handleClick}
      title="Select a project folder"
    >
      <div className="border-border mb-2 flex size-8 items-center justify-center rounded-xs border border-dashed transition-colors duration-300">
        <FolderOpen className="text-muted-foreground size-4 transition-colors" />
      </div>
      <span className="text-muted-foreground text-xs transition-colors">Select Folder</span>
    </button>
  );
};

// Projects Grid

interface ProjectsGridProps {
  searchQuery: string;
  maxProjects?: number;
}

const ProjectsGrid = ({
  searchQuery,
  maxProjects = 12,
}: Readonly<ProjectsGridProps>): React.JSX.Element => {
  const {
    repositoryGroups,
    repositoryGroupsLoading,
    fetchRepositoryGroups,
    selectRepository,
    projects,
    projectsLoading,
    fetchProjects,
    setActiveProject,
  } = useStore(
    useShallow((s) => ({
      repositoryGroups: s.repositoryGroups,
      repositoryGroupsLoading: s.repositoryGroupsLoading,
      fetchRepositoryGroups: s.fetchRepositoryGroups,
      selectRepository: s.selectRepository,
      projects: s.projects,
      projectsLoading: s.projectsLoading,
      fetchProjects: s.fetchProjects,
      setActiveProject: s.setActiveProject,
    }))
  );

  // Use flat projects when repository groups are empty
  const useFlat = repositoryGroups.length === 0;

  useEffect(() => {
    if (useFlat) {
      if (projects.length === 0 && !projectsLoading) {
        void fetchProjects();
      }
    } else if (repositoryGroups.length === 0) {
      void fetchRepositoryGroups();
    }
  }, [
    useFlat,
    repositoryGroups.length,
    projects.length,
    projectsLoading,
    fetchRepositoryGroups,
    fetchProjects,
  ]);

  // Build unified items for rendering
  const filteredRepos = useMemo(() => {
    // Convert flat projects to RepositoryGroup-like shape for RepositoryCard
    const items: RepositoryGroup[] = useFlat
      ? projects
          .filter((p) => p.sessions.length > 0)
          .map((p) => ({
            id: p.id,
            name: p.name,
            identity: null,
            totalSessions: p.sessions.length,
            mostRecentSession: p.mostRecentSession,
            worktrees: [
              {
                id: p.id,
                name: 'main',
                path: p.path,
                sessions: p.sessions,
                isMainWorktree: true,
                source: 'unknown' as const,
                createdAt: p.createdAt,
                mostRecentSession: p.mostRecentSession,
              },
            ],
          }))
      : repositoryGroups;

    if (!searchQuery.trim()) {
      return items.slice(0, maxProjects);
    }

    const query = searchQuery.toLowerCase().trim();
    return items
      .filter((repo) => {
        if (repo.name.toLowerCase().includes(query)) return true;
        const path = repo.worktrees[0]?.path || '';
        if (path.toLowerCase().includes(query)) return true;
        return false;
      })
      .slice(0, maxProjects);
  }, [useFlat, projects, repositoryGroups, searchQuery, maxProjects]);

  if (useFlat ? projectsLoading : repositoryGroupsLoading) {
    // Organic widths per card — no repeating stamp
    const titleWidths = [60, 66, 50, 55, 75, 45, 40, 65];
    const pathWidths = [80, 75, 85, 66, 70, 80, 60, 72];

    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton
            key={i}
            className="border-border flex min-h-[120px] flex-col rounded-xs border p-4"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            {/* Icon placeholder */}
            <div className="bg-muted-foreground/10 mb-3 size-8 rounded-xs" />
            {/* Title placeholder */}
            <div
              className="bg-muted-foreground/10 mb-2 h-3.5 rounded-xs"
              style={{ width: `${titleWidths[i]}%` }}
            />
            {/* Path placeholder */}
            <div
              className="bg-muted-foreground/5 mb-auto h-2.5 rounded-xs"
              style={{ width: `${pathWidths[i]}%` }}
            />
            {/* Meta row placeholder */}
            <div className="mt-3 flex gap-2">
              <div className="bg-muted-foreground/5 h-2.5 w-16 rounded-xs" />
              <div className="bg-muted-foreground/5 h-2.5 w-12 rounded-xs" />
            </div>
          </Skeleton>
        ))}
      </div>
    );
  }

  if (filteredRepos.length === 0 && searchQuery.trim()) {
    return (
      <div className="border-border flex flex-col items-center justify-center rounded-xs border border-dashed px-8 py-16">
        <div className="border-border bg-card mb-4 flex size-12 items-center justify-center rounded-xs border">
          <Search className="text-muted-foreground size-6" />
        </div>
        <p className="text-muted-foreground mb-1 text-sm">No projects found</p>
        <p className="text-muted-foreground text-xs">No matches for &quot;{searchQuery}&quot;</p>
      </div>
    );
  }

  if ((useFlat ? projects : repositoryGroups).length === 0) {
    return (
      <div className="border-border flex flex-col items-center justify-center rounded-xs border border-dashed px-8 py-16">
        <div className="border-border bg-card mb-4 flex size-12 items-center justify-center rounded-xs border">
          <FolderGit2 className="text-muted-foreground size-6" />
        </div>
        <p className="text-muted-foreground mb-1 text-sm">No projects found</p>
        <p className="text-muted-foreground font-mono text-xs">~/.claude/projects/</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
      {filteredRepos.map((repo) => (
        <RepositoryCard
          key={repo.id}
          repo={repo}
          onClick={() => (useFlat ? setActiveProject(repo.id) : selectRepository(repo.id))}
          isHighlighted={!!searchQuery.trim()}
        />
      ))}
      {!searchQuery.trim() && <NewProjectCard />}
    </div>
  );
};

export const DashboardView = (): React.JSX.Element => {
  const [searchQuery, setSearchQuery] = useState('');
  const openSettingsTab = useStore((s) => s.openSettingsTab);

  return (
    <div className="bg-background relative flex-1 overflow-auto">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[600px] bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.08),transparent)]"
        aria-hidden="true"
      />

      <div className="relative mx-auto max-w-5xl px-8 py-12">
        <div className="mb-8">
          <CommandSearch
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search projects..."
          />
        </div>

        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
            {searchQuery.trim() ? 'Search Results' : 'Recent Projects'}
          </h2>
          <div className="flex items-center gap-3">
            {searchQuery.trim() && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setSearchQuery('')}
                className="text-muted-foreground hover:text-foreground"
              >
                Clear search
              </Button>
            )}
            <Button
              variant="ghost"
              size="xs"
              onClick={() => openSettingsTab('general')}
              title="Change Claude data folder"
              className="text-muted-foreground hover:text-foreground gap-1.5"
            >
              <Settings className="size-3" />
              Change default folder
            </Button>
          </div>
        </div>

        <ProjectsGrid searchQuery={searchQuery} />
      </div>
    </div>
  );
};
