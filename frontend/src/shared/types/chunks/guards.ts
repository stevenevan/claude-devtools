import { type AIChunk, type Chunk } from './baseChunks';
import { type EnhancedAIChunk, type EnhancedChunk } from './enhancedChunks';

function isAIChunk(chunk: Chunk | EnhancedChunk): chunk is AIChunk {
  return 'chunkType' in chunk && chunk.chunkType === 'ai';
}

export function isEnhancedAIChunk(chunk: Chunk | EnhancedChunk): chunk is EnhancedAIChunk {
  return isAIChunk(chunk) && 'semanticSteps' in chunk;
}
