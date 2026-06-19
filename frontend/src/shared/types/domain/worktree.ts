/**
 * Worktree source identifies how/where the worktree was created.
 * Used for badge display and source-specific naming strategies.
 */
export type WorktreeSource =
  | 'vibe-kanban' // /tmp/vibe-kanban/worktrees/{issue-branch}/{repo}
  | 'conductor' // /Users/.../conductor/workspaces/{repo}/{workspace}
  | 'auto-claude' // /Users/.../.auto-claude/worktrees/tasks/{task-id}
  | '21st' // /Users/.../.21st/worktrees/{id}/{name [bracket-id]}
  | 'claude-desktop' // /Users/.../.claude-worktrees/{repo}/{name}
  | 'ccswitch' // /Users/.../.ccswitch/worktrees/{repo}/{name}
  | 'git' // Standard git worktree (main repo or detached)
  | 'unknown'; // Non-git project or undetectable

/**
 * Git repository identity for grouping worktrees.
 * Multiple projects (worktrees) can share the same RepositoryIdentity.
 */
export interface RepositoryIdentity {
  /** Unique identifier - hash of remote URL or main repo path */
  id: string;
  /** Git remote URL if available (e.g., "https://github.com/org/repo.git") */
  remoteUrl?: string;
  /** Path to the main git directory (e.g., "/Users/username/projectname/.git") */
  mainGitDir: string;
  /** Display name for the repository (e.g., "projectname") */
  name: string;
}

/**
 * A worktree represents a single working directory of a git repository.
 * In the grouped view, projects become worktrees under a RepositoryGroup.
 */
export interface Worktree {
  /** Encoded directory name (same as Project.id) */
  id: string;
  /** Decoded actual filesystem path */
  path: string;
  /** Display name (worktree-specific, e.g., branch name or "main") */
  name: string;
  /** Git branch name if available */
  gitBranch?: string;
  /** Whether this is the main worktree (not a detached worktree) */
  isMainWorktree: boolean;
  /** Worktree source for badge display (vibe-kanban, conductor, etc.) */
  source: WorktreeSource;
  /** List of session IDs */
  sessions: string[];
  /** Unix timestamp when first session was created */
  createdAt: number;
  /** Unix timestamp of most recent session activity */
  mostRecentSession?: number;
}

/**
 * A repository group contains all worktrees of a single git repository.
 * This is the top-level entity when worktree grouping is enabled.
 * Non-git projects are represented as single-worktree RepositoryGroups.
 */
export interface RepositoryGroup {
  /** Unique identifier from RepositoryIdentity.id (or project.id for non-git) */
  id: string;
  /** Repository identity information (null for non-git projects) */
  identity: RepositoryIdentity | null;
  /** All worktrees of this repository */
  worktrees: Worktree[];
  /** Display name (derived from repo name) */
  name: string;
  /** Unix timestamp of most recent session across all worktrees */
  mostRecentSession?: number;
  /** Total session count across all worktrees */
  totalSessions: number;
}
