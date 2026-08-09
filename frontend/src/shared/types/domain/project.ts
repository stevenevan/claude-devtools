import { type UsageMetadata } from '../jsonl';

export type TokenUsage = UsageMetadata;

export type MessageType =
  | 'user'
  | 'assistant'
  | 'system'
  | 'summary'
  | 'file-history-snapshot'
  | 'queue-operation';

export type MessageCategory = 'user' | 'system' | 'hardNoise' | 'ai' | 'compact';

export interface Project {

  id: string;

  path: string;

  name: string;

  sessions: string[];

  createdAt: number;

  mostRecentSession?: number;
}

export type SessionMetadataLevel = 'light' | 'deep';

export interface PhaseTokenBreakdown {

  phaseNumber: number;

  contribution: number;

  peakTokens: number;

  postCompaction?: number;
}

export interface Session {

  id: string;

  projectId: string;

  projectPath: string;

  todoData?: unknown;

  createdAt: number;

  firstMessage?: string;

  messageTimestamp?: string;

  hasSubagents: boolean;

  messageCount: number;

  costUsd?: number;

  isOngoing?: boolean;

  gitBranch?: string;

  metadataLevel?: SessionMetadataLevel;

  contextConsumption?: number;

  compactionCount?: number;

  phaseBreakdown?: PhaseTokenBreakdown[];

  customTitle?: string;

  agentName?: string;
}

export interface GlobalSession {
  id: string;
  projectId: string;
  projectPath: string;
  projectName: string;
  createdAt: number;
  firstMessage?: string;
  messageTimestamp?: string;
  messageCount: number;
  customTitle?: string;
  agentName?: string;
  model?: string;
  costUsd?: number;
}

export interface SessionMetrics {

  durationMs: number;

  totalTokens: number;

  inputTokens: number;

  outputTokens: number;

  cacheReadTokens: number;

  cacheCreationTokens: number;

  messageCount: number;

  costUsd?: number;

  model?: string;
}

export interface SessionsByIdsOptions {

  metadataLevel?: SessionMetadataLevel;
}
