import { type ParsedMessage } from '../messages';

import {
  type AIChunk,
  type CompactChunk,
  type EventChunk,
  type SystemChunk,
  type UserChunk,
} from './baseChunks';
import { type SemanticStep, type SemanticStepGroup } from './semanticSteps';

/**
 * Enhanced AI chunk with semantic step breakdown.
 * This extends AIChunk with additional visualization data.
 */
export interface EnhancedAIChunk extends AIChunk {
  /** Semantic steps extracted from messages */
  semanticSteps: SemanticStep[];
  /** Semantic steps grouped for collapsible UI */
  semanticStepGroups?: SemanticStepGroup[];
  /** Raw messages for debug sidebar */
  rawMessages: ParsedMessage[];
  /** Number of progress updates during this AI chunk */
  progressCount?: number;
  /** Progress message texts during this AI chunk */
  progressTexts?: string[];
}

/**
 * Enhanced user chunk with additional metadata.
 */
export interface EnhancedUserChunk extends UserChunk {
  /** Raw messages for debug sidebar */
  rawMessages: ParsedMessage[];
}

/**
 * Enhanced system chunk with additional metadata.
 */
export interface EnhancedSystemChunk extends SystemChunk {
  /** Raw messages for debug sidebar */
  rawMessages: ParsedMessage[];
}

/**
 * Enhanced compact chunk with additional metadata.
 */
export interface EnhancedCompactChunk extends CompactChunk {
  /** Raw messages for debug sidebar */
  rawMessages: ParsedMessage[];
}

/**
 * Enhanced event chunk with additional metadata.
 */
export interface EnhancedEventChunk extends EventChunk {
  /** Raw messages for debug sidebar */
  rawMessages: ParsedMessage[];
}

/**
 * Enhanced chunk can be user, AI, system, compact, or event type.
 */
export type EnhancedChunk =
  | EnhancedUserChunk
  | EnhancedAIChunk
  | EnhancedSystemChunk
  | EnhancedCompactChunk
  | EnhancedEventChunk;
