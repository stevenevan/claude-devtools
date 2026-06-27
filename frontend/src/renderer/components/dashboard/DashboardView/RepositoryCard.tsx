
import { JSX } from 'react';
import { cn } from '@renderer/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { FolderGit2, GitBranch } from 'lucide-react';

import type { RepositoryGroup } from '@renderer/types/data';

interface RepositoryCardProps {
  repo: RepositoryGroup;
  onClick: () => void;
  isHighlighted?: boolean;
}

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

export const RepositoryCard = ({
  repo,
  onClick,
  isHighlighted,
}: Readonly<RepositoryCardProps>): JSX.Element => {
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
