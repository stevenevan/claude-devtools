import { type SessionMetrics } from '../domain';
import { type ParsedMessage } from '../messages';

export interface Process {

  id: string;

  filePath: string;

  messages: ParsedMessage[];

  startTime: Date;

  endTime: Date;

  durationMs: number;

  metrics: SessionMetrics;

  description?: string;

  subagentType?: string;

  isParallel: boolean;

  parentTaskId?: string;

  isOngoing?: boolean;

  mainSessionImpact?: {

    callTokens: number;

    resultTokens: number;

    totalTokens: number;
  };

  team?: {
    teamName: string;
    memberName: string;
    memberColor: string;
  };
}
