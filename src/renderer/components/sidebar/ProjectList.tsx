import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { FolderGit2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

export const ProjectList = (): React.JSX.Element => {
  const {
    projects,
    repositoryGroups,
    viewMode,
    activeProjectId,
    selectedRepositoryId,
    setActiveProject,
    selectRepository,
  } = useStore(
    useShallow((s) => ({
      projects: s.projects,
      repositoryGroups: s.repositoryGroups,
      viewMode: s.viewMode,
      activeProjectId: s.activeProjectId,
      selectedRepositoryId: s.selectedRepositoryId,
      setActiveProject: s.setActiveProject,
      selectRepository: s.selectRepository,
    }))
  );

  const items =
    viewMode === 'grouped'
      ? repositoryGroups
          .filter((r) => r.totalSessions > 0)
          .map((r) => ({
            id: r.id,
            name: r.name,
            path: r.worktrees[0]?.path,
            sessionCount: r.totalSessions,
          }))
      : projects
          .filter((p) => p.sessions.length > 0)
          .map((p) => ({
            id: p.id,
            name: p.name,
            path: p.path,
            sessionCount: p.sessions.length,
          }));

  const selectedId = viewMode === 'grouped' ? selectedRepositoryId : activeProjectId;

  const handleSelect = (id: string): void => {
    if (viewMode === 'grouped') {
      selectRepository(id);
    } else {
      setActiveProject(id);
    }
  };

  if (items.length === 0) {
    return (
      <div className="text-muted-foreground py-12 text-center text-sm">
        <FolderGit2 className="mx-auto mb-2 size-8 opacity-50" />
        <p>No projects found</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {items.map((item) => {
        const isSelected = item.id === selectedId;
        return (
          <button
            key={item.id}
            onClick={() => handleSelect(item.id)}
            className={cn(
              'flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors',
              isSelected
                ? 'bg-white/[0.06] text-foreground'
                : 'text-muted-foreground hover:bg-white/[0.03] hover:text-foreground'
            )}
          >
            <FolderGit2
              className={cn('size-4 shrink-0', isSelected ? 'text-indigo-400' : 'opacity-60')}
            />
            <div className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{item.name}</span>
              {item.path && (
                <span className="text-muted-foreground block truncate text-[10px]">
                  {item.path}
                </span>
              )}
            </div>
            <span className="text-muted-foreground shrink-0 text-[10px]">{item.sessionCount}</span>
          </button>
        );
      })}
    </div>
  );
};
