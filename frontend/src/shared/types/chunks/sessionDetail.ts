import { type Session, type SessionMetrics } from '../domain';
import { type ParsedMessage } from '../messages';

import { type Chunk } from './baseChunks';
import { type EnhancedChunk } from './enhancedChunks';
import { type Process } from './processes';
import { type SemanticStepGroup } from './semanticSteps';

/**
 * Complete parsed session with all data.
 */
export interface SessionDetail {
  /** Session metadata */
  session: Session;
  /** All messages in the session */
  messages: ParsedMessage[];
  /** Messages grouped into chunks */
  chunks: Chunk[];
  /** All processes in the session */
  processes: Process[];
  /** Aggregated metrics for the entire session */
  metrics: SessionMetrics;
}

/**
 * Detailed subagent information for drill-down modal.
 * Contains parsed execution data for a specific subagent.
 */
export interface SubagentDetail {
  /** Agent ID */
  id: string;
  /** Task description */
  description: string;
  /** Subagent's chunks with semantic breakdown */
  chunks: EnhancedChunk[];
  /** Semantic step groups for visualization */
  semanticStepGroups?: SemanticStepGroup[];
  /** Start time */
  startTime: Date;
  /** End time */
  endTime: Date;
  /** Duration in milliseconds */
  duration: number;
  /** Token and message metrics */
  metrics: {
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    messageCount: number;
  };
}
