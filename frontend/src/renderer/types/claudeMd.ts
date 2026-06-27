

// Source Types

export type ClaudeMdSource =
  | 'enterprise'
  | 'user-memory'
  | 'user-rules'
  | 'auto-memory'
  | 'project-memory'
  | 'project-rules'
  | 'project-local'
  | 'directory';

// Injection Types

export interface ClaudeMdInjection {

  id: string;

  path: string;

  source: ClaudeMdSource;

  displayName: string;

  isGlobal: boolean;

  estimatedTokens: number;

  firstSeenInGroup: string;
}

// Statistics Types

export interface ClaudeMdStats {

  newInjections: ClaudeMdInjection[];

  accumulatedInjections: ClaudeMdInjection[];

  totalEstimatedTokens: number;

  percentageOfContext: number;

  newCount: number;

  accumulatedCount: number;
}
