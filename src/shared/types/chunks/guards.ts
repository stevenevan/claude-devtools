import {
  type AIChunk,
  type Chunk,
  type CompactChunk,
  type EventChunk,
  type SystemChunk,
  type UserChunk,
} from './baseChunks';
import { type EnhancedAIChunk, type EnhancedChunk } from './enhancedChunks';

/**
 * Type guard to check if a chunk is a UserChunk.
 */
export function isUserChunk(chunk: Chunk | EnhancedChunk): chunk is UserChunk {
  return 'chunkType' in chunk && chunk.chunkType === 'user';
}

/**
 * Type guard to check if a chunk is an AIChunk.
 */
export function isAIChunk(chunk: Chunk | EnhancedChunk): chunk is AIChunk {
  return 'chunkType' in chunk && chunk.chunkType === 'ai';
}

/**
 * Type guard to check if a chunk is an EnhancedAIChunk.
 */
export function isEnhancedAIChunk(chunk: Chunk | EnhancedChunk): chunk is EnhancedAIChunk {
  return isAIChunk(chunk) && 'semanticSteps' in chunk;
}

/**
 * Type guard to check if a chunk is a SystemChunk.
 */
export function isSystemChunk(chunk: Chunk | EnhancedChunk): chunk is SystemChunk {
  return 'chunkType' in chunk && chunk.chunkType === 'system';
}

/**
 * Type guard to check if a chunk is a CompactChunk.
 */
export function isCompactChunk(chunk: Chunk | EnhancedChunk): chunk is CompactChunk {
  return 'chunkType' in chunk && chunk.chunkType === 'compact';
}

/**
 * Type guard to check if a chunk is an EventChunk.
 */
export function isEventChunk(chunk: Chunk | EnhancedChunk): chunk is EventChunk {
  return 'chunkType' in chunk && chunk.chunkType === 'event';
}
