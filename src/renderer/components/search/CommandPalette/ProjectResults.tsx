import { CommandEmpty, CommandGroup, CommandItem } from '@renderer/components/ui/command';
import { formatDistanceToNow } from 'date-fns';
import { FolderGit2 } from 'lucide-react';

import type { RepositoryGroup } from '@renderer/types/data';

interface ProjectResultsProps {
  projects: RepositoryGroup[];
  query: string;
  onSelect: (repoId: string) => void;
}

export const ProjectResults = ({ projects, query, onSelect }: ProjectResultsProps): JSX.Element => {
  return (
    <CommandGroup heading="Projects">
      {projects.map((repo) => (
        <CommandItem
          key={repo.id}
          value={repo.id}
          onSelect={() => onSelect(repo.id)}
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
      {projects.length === 0 && (
        <CommandEmpty>
          {query.trim() ? `No projects found for "${query}"` : 'No projects found'}
        </CommandEmpty>
      )}
    </CommandGroup>
  );
};
