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
import { useStore } from '@renderer/store';
import { formatShortcut } from '@renderer/utils/stringUtils';
import { createLogger } from '@shared/utils/logger';
import { useShallow } from 'zustand/react/shallow';

const logger = createLogger('Component:DashboardView');
import { formatDistanceToNow } from 'date-fns';
import { Command, FolderGit2, FolderOpen, GitBranch, Search, Settings } from 'lucide-react';

import type { RepositoryGroup } from '@renderer/types/data';

// =============================================================================
// Command Search Input
// =============================================================================

interface CommandSearchProps {
  value: string;
  onChange: (value: string) => void;
}

const CommandSearch = ({ value, onChange }: Readonly<CommandSearchProps>): React.JSX.Element => {
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
        className={`bg-surface-raised relative flex items-center gap-3 rounded-xs border px-4 py-3 transition-all duration-200 ${
          isFocused
            ? 'border-zinc-500 shadow-[0_0_20px_rgba(255,255,255,0.04)] ring-1 ring-zinc-600/30'
            : 'border-border hover:border-zinc-600'
        } `}
      >
        <Search className="text-text-muted size-4 shrink-0" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search projects..."
          className="text-text placeholder:text-text-muted flex-1 bg-transparent text-sm outline-hidden"
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
          <kbd className="border-border bg-surface-overlay text-text-muted flex h-5 items-center justify-center rounded-sm border px-1.5 text-[10px] font-medium">
            <Command className="size-2.5" />
          </kbd>
          <kbd className="border-border bg-surface-overlay text-text-muted flex size-5 items-center justify-center rounded-sm border text-[10px] font-medium">
            K
          </kbd>
        </button>
      </div>
    </div>
  );
};

// =============================================================================
// Repository Card
// =============================================================================

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
      className={`group relative flex min-h-[120px] flex-col overflow-hidden rounded-xs border p-4 text-left transition-all duration-300 ${
        isHighlighted
          ? 'border-border-emphasis bg-surface-raised'
          : 'bg-surface/50 border-border hover:border-border-emphasis hover:bg-surface-raised'
      } `}
    >
      {/* Icon with subtle border */}
      <div className="border-border bg-surface-overlay group-hover:border-border-emphasis mb-3 flex size-8 items-center justify-center rounded-xs border transition-colors duration-300">
        <FolderGit2 className="text-text-secondary group-hover:text-text size-4 transition-colors" />
      </div>

      {/* Project name */}
      <h3 className="text-text group-hover:text-text mb-1 truncate text-sm font-medium transition-colors duration-200">
        {repo.name}
      </h3>

      {/* Project path - monospace, muted */}
      <p className="text-text-muted mb-auto truncate font-mono text-[10px]">{formattedPath}</p>

      {/* Meta row: worktrees, sessions, time */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {hasMultipleWorktrees && (
          <span className="text-text-secondary inline-flex items-center gap-1 text-[10px]">
            <GitBranch className="size-3" />
            {worktreeCount} worktrees
          </span>
        )}
        <span className="text-text-secondary text-[10px]">{repo.totalSessions} sessions</span>
        <span className="text-text-muted">·</span>
        <span className="text-text-muted text-[10px]">{lastActivity}</span>
      </div>
    </button>
  );
};

// =============================================================================
// Ghost Card (New Project)
// =============================================================================

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
      className="hover:bg-surface/30 group border-border hover:border-border-emphasis relative flex min-h-[120px] flex-col items-center justify-center rounded-xs border border-dashed bg-transparent p-4 transition-all duration-300"
      onClick={handleClick}
      title="Select a project folder"
    >
      <div className="border-border group-hover:border-border-emphasis mb-2 flex size-8 items-center justify-center rounded-xs border border-dashed transition-colors duration-300">
        <FolderOpen className="text-text-muted group-hover:text-text-secondary size-4 transition-colors" />
      </div>
      <span className="text-text-muted group-hover:text-text-secondary text-xs transition-colors">
        Select Folder
      </span>
    </button>
  );
};

// =============================================================================
// Projects Grid
// =============================================================================

interface ProjectsGridProps {
  searchQuery: string;
  maxProjects?: number;
}

const ProjectsGrid = ({
  searchQuery,
  maxProjects = 12,
}: Readonly<ProjectsGridProps>): React.JSX.Element => {
  const { repositoryGroups, repositoryGroupsLoading, fetchRepositoryGroups, selectRepository } =
    useStore(
      useShallow((s) => ({
        repositoryGroups: s.repositoryGroups,
        repositoryGroupsLoading: s.repositoryGroupsLoading,
        fetchRepositoryGroups: s.fetchRepositoryGroups,
        selectRepository: s.selectRepository,
      }))
    );

  useEffect(() => {
    if (repositoryGroups.length === 0) {
      void fetchRepositoryGroups();
    }
  }, [repositoryGroups.length, fetchRepositoryGroups]);

  // Filter projects based on search query
  const filteredRepos = useMemo(() => {
    if (!searchQuery.trim()) {
      return repositoryGroups.slice(0, maxProjects);
    }

    const query = searchQuery.toLowerCase().trim();
    return repositoryGroups
      .filter((repo) => {
        // Match by name
        if (repo.name.toLowerCase().includes(query)) return true;
        // Match by path
        const path = repo.worktrees[0]?.path || '';
        if (path.toLowerCase().includes(query)) return true;
        return false;
      })
      .slice(0, maxProjects);
  }, [repositoryGroups, searchQuery, maxProjects]);

  if (repositoryGroupsLoading) {
    // Organic widths per card — no repeating stamp
    const titleWidths = [60, 66, 50, 55, 75, 45, 40, 65];
    const pathWidths = [80, 75, 85, 66, 70, 80, 60, 72];

    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="skeleton-card border-border flex min-h-[120px] flex-col rounded-xs border p-4"
            style={{
              animationDelay: `${i * 80}ms`,
              backgroundColor: 'var(--skeleton-base)',
            }}
          >
            {/* Icon placeholder */}
            <div
              className="mb-3 size-8 rounded-xs"
              style={{ backgroundColor: 'var(--skeleton-base-light)' }}
            />
            {/* Title placeholder */}
            <div
              className="mb-2 h-3.5 rounded-xs"
              style={{
                width: `${titleWidths[i]}%`,
                backgroundColor: 'var(--skeleton-base-light)',
              }}
            />
            {/* Path placeholder */}
            <div
              className="mb-auto h-2.5 rounded-xs"
              style={{
                width: `${pathWidths[i]}%`,
                backgroundColor: 'var(--skeleton-base-dim)',
              }}
            />
            {/* Meta row placeholder */}
            <div className="mt-3 flex gap-2">
              <div
                className="h-2.5 w-16 rounded-xs"
                style={{ backgroundColor: 'var(--skeleton-base-dim)' }}
              />
              <div
                className="h-2.5 w-12 rounded-xs"
                style={{ backgroundColor: 'var(--skeleton-base-dim)' }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (filteredRepos.length === 0 && searchQuery.trim()) {
    return (
      <div className="border-border flex flex-col items-center justify-center rounded-xs border border-dashed px-8 py-16">
        <div className="border-border bg-surface-raised mb-4 flex size-12 items-center justify-center rounded-xs border">
          <Search className="text-text-muted size-6" />
        </div>
        <p className="text-text-secondary mb-1 text-sm">No projects found</p>
        <p className="text-text-muted text-xs">No matches for &quot;{searchQuery}&quot;</p>
      </div>
    );
  }

  if (repositoryGroups.length === 0) {
    return (
      <div className="border-border flex flex-col items-center justify-center rounded-xs border border-dashed px-8 py-16">
        <div className="border-border bg-surface-raised mb-4 flex size-12 items-center justify-center rounded-xs border">
          <FolderGit2 className="text-text-muted size-6" />
        </div>
        <p className="text-text-secondary mb-1 text-sm">No projects found</p>
        <p className="text-text-muted font-mono text-xs">~/.claude/projects/</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
      {filteredRepos.map((repo) => (
        <RepositoryCard
          key={repo.id}
          repo={repo}
          onClick={() => selectRepository(repo.id)}
          isHighlighted={!!searchQuery.trim()}
        />
      ))}
      {!searchQuery.trim() && <NewProjectCard />}
    </div>
  );
};

// =============================================================================
// Dashboard View
// =============================================================================

export const DashboardView = (): React.JSX.Element => {
  const [searchQuery, setSearchQuery] = useState('');
  const openSettingsTab = useStore((s) => s.openSettingsTab);

  return (
    <div className="bg-surface relative flex-1 overflow-auto">
      {/* Spotlight gradient background */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[600px] bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.08),transparent)]"
        aria-hidden="true"
      />

      {/* Content */}
      <div className="relative mx-auto max-w-5xl px-8 py-12">
        {/* Command Search */}
        <div className="mb-12">
          <CommandSearch value={searchQuery} onChange={setSearchQuery} />
        </div>

        {/* Section header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-text-muted text-xs font-medium tracking-wider uppercase">
            {searchQuery.trim() ? 'Search Results' : 'Recent Projects'}
          </h2>
          <div className="flex items-center gap-3">
            {searchQuery.trim() && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-text-muted hover:text-text-secondary text-xs transition-colors"
              >
                Clear search
              </button>
            )}
            <button
              onClick={() => openSettingsTab('general')}
              className="text-text-muted hover:text-text-secondary flex items-center gap-1.5 text-xs transition-colors"
              title="Change Claude data folder"
            >
              <Settings className="size-3" />
              Change default folder
            </button>
          </div>
        </div>

        {/* Projects Grid */}
        <ProjectsGrid searchQuery={searchQuery} />
      </div>
    </div>
  );
};
