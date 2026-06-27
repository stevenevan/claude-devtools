
export type WorktreeSource =
  | 'vibe-kanban' // /tmp/vibe-kanban/worktrees/{issue-branch}/{repo}
  | 'conductor' // /Users/.../conductor/workspaces/{repo}/{workspace}
  | 'auto-claude' // /Users/.../.auto-claude/worktrees/tasks/{task-id}
  | '21st' // /Users/.../.21st/worktrees/{id}/{name [bracket-id]}
  | 'claude-desktop' // /Users/.../.claude-worktrees/{repo}/{name}
  | 'ccswitch' // /Users/.../.ccswitch/worktrees/{repo}/{name}
  | 'git' // Standard git worktree (main repo or detached)
  | 'unknown'; // Non-git project or undetectable

export interface RepositoryIdentity {

  id: string;

  remoteUrl?: string;

  mainGitDir: string;

  name: string;
}

export interface Worktree {

  id: string;

  path: string;

  name: string;

  gitBranch?: string;

  isMainWorktree: boolean;

  source: WorktreeSource;

  sessions: string[];

  createdAt: number;

  mostRecentSession?: number;
}

export interface RepositoryGroup {

  id: string;

  identity: RepositoryIdentity | null;

  worktrees: Worktree[];

  name: string;

  mostRecentSession?: number;

  totalSessions: number;
}
