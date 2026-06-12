import React, { useEffect, useMemo } from 'react';

import { Skeleton } from '@renderer/components/ui/skeleton';
import { useStore } from '@renderer/store';
import { FolderGit2, Search } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { NewProjectCard } from './NewProjectCard';
import { RepositoryCard } from './RepositoryCard';

import type { RepositoryGroup } from '@renderer/types/data';

interface ProjectsGridProps {
  searchQuery: string;
  maxProjects?: number;
}

export const ProjectsGrid = ({
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
