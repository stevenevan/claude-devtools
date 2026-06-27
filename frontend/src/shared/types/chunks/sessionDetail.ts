import { type Session, type SessionMetrics } from '../domain';
import { type ParsedMessage } from '../messages';

import { type Chunk } from './baseChunks';
import { type EnhancedChunk } from './enhancedChunks';
import { type Process } from './processes';
import { type SemanticStepGroup } from './semanticSteps';

export interface SessionDetail {

  session: Session;

  messages: ParsedMessage[];

  chunks: Chunk[];

  processes: Process[];

  metrics: SessionMetrics;
}

export interface SubagentDetail {

  id: string;

  description: string;

  chunks: EnhancedChunk[];

  semanticStepGroups?: SemanticStepGroup[];

  startTime: Date;

  endTime: Date;

  duration: number;

  metrics: {
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    messageCount: number;
  };
}
