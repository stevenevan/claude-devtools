import { type ParsedMessage } from '../messages';

import {
  type AIChunk,
  type CompactChunk,
  type EventChunk,
  type SystemChunk,
  type UserChunk,
} from './baseChunks';
import { type SemanticStep, type SemanticStepGroup } from './semanticSteps';

export interface EnhancedAIChunk extends AIChunk {

  semanticSteps: SemanticStep[];

  semanticStepGroups?: SemanticStepGroup[];

  rawMessages: ParsedMessage[];

  progressCount?: number;

  progressTexts?: string[];
}

export interface EnhancedUserChunk extends UserChunk {

  rawMessages: ParsedMessage[];
}

export interface EnhancedSystemChunk extends SystemChunk {

  rawMessages: ParsedMessage[];
}

export interface EnhancedCompactChunk extends CompactChunk {

  rawMessages: ParsedMessage[];
}

export interface EnhancedEventChunk extends EventChunk {

  rawMessages: ParsedMessage[];
}

export type EnhancedChunk =
  | EnhancedUserChunk
  | EnhancedAIChunk
  | EnhancedSystemChunk
  | EnhancedCompactChunk
  | EnhancedEventChunk;
