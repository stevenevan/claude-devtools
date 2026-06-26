import {
  isEnhancedAIChunk,
  isEnhancedCompactChunk,
  isEnhancedEventChunk,
  isEnhancedSystemChunk,
  isEnhancedUserChunk,
} from '@renderer/types/data';
import { createLogger } from '@shared/utils/logger';

import {
  createAIGroupFromChunk,
  getFirstAssistantTotalTokens,
  getLastAssistantTotalTokens,
} from './grouping/aiSummary';
import { createUserGroupFromChunk } from './grouping/userContent';

import type {
  EnhancedChunk,
  EnhancedCompactChunk,
  EnhancedEventChunk,
  EnhancedSystemChunk,
  Process,
} from '@renderer/types/data';
import type {
  AIGroup,
  AIGroupStatus,
  ChatItem,
  CompactGroup,
  EventGroup,
  SessionConversation,
  SystemGroup,
} from '@renderer/types/groups';

export { extractFileReferences } from './grouping/contentParsing';

const logger = createLogger('Util:groupTransformer');

export function transformChunksToConversation(
  chunks: EnhancedChunk[],
  _subagents: Process[],
  isOngoing: boolean = false
): SessionConversation {
  if (!chunks || chunks.length === 0) {
    return {
      sessionId: '',
      items: [],
      totalUserGroups: 0,
      totalSystemGroups: 0,
      totalAIGroups: 0,
      totalCompactGroups: 0,
      totalEventGroups: 0,
    };
  }

  const items: ChatItem[] = [];
  let userCount = 0;
  let systemCount = 0;
  let aiCount = 0;
  let compactCount = 0;
  let eventCount = 0;

  for (const chunk of chunks) {
    if (isEnhancedUserChunk(chunk)) {
      items.push({
        type: 'user',
        group: createUserGroupFromChunk(chunk, userCount++),
      });
    } else if (isEnhancedSystemChunk(chunk)) {
      items.push({
        type: 'system',
        group: createSystemGroup(chunk),
      });
      systemCount++;
    } else if (isEnhancedAIChunk(chunk)) {
      items.push({
        type: 'ai',
        group: createAIGroupFromChunk(chunk, aiCount),
      });
      aiCount++;
    } else if (isEnhancedCompactChunk(chunk)) {
      items.push({
        type: 'compact',
        group: createCompactGroup(chunk),
      });
      compactCount++;
    } else if (isEnhancedEventChunk(chunk)) {
      items.push({
        type: 'event',
        group: createEventGroup(chunk),
      });
      eventCount++;
    } else {
      const unhandledChunkType =
        'chunkType' in chunk ? (chunk as EnhancedChunk).chunkType : 'unknown';
      logger.warn('Unhandled chunk type:', unhandledChunkType);
    }
  }

  let phaseCounter = 1;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type === 'compact') {
      phaseCounter++;
      const compactItem = items[i] as { type: 'compact'; group: CompactGroup };
      compactItem.group.startingPhaseNumber = phaseCounter;

      const preAi = findLastAiBefore(items, i);
      const postAi = findFirstAiAfter(items, i);
      if (preAi && postAi) {
        const pre = getLastAssistantTotalTokens(preAi);
        const post = getFirstAssistantTotalTokens(postAi);
        if (pre !== undefined && post !== undefined) {
          compactItem.group.tokenDelta = {
            preCompactionTokens: pre,
            postCompactionTokens: post,
            delta: post - pre,
          };
        }
      }
    }
  }

  if (isOngoing && aiCount > 0) {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item.type === 'ai') {
        const currentStatus = item.group.status;
        if (currentStatus !== 'interrupted') {
          (item.group as AIGroup & { isOngoing?: boolean }).isOngoing = true;
          (item.group as AIGroup & { status?: AIGroupStatus }).status = 'in_progress';
        }
        break;
      }
    }
  }

  return {
    sessionId: chunks[0]?.id ?? 'unknown',
    items,
    totalUserGroups: userCount,
    totalSystemGroups: systemCount,
    totalAIGroups: aiCount,
    totalCompactGroups: compactCount,
    totalEventGroups: eventCount,
  };
}

function createSystemGroup(chunk: EnhancedSystemChunk): SystemGroup {
  return {
    id: chunk.id,
    message: chunk.message,
    timestamp: chunk.startTime,
    commandOutput: chunk.commandOutput,
  };
}

function createCompactGroup(chunk: EnhancedCompactChunk): CompactGroup {
  return {
    id: chunk.id,
    timestamp: chunk.startTime,
    message: chunk.message,
  };
}

function createEventGroup(chunk: EnhancedEventChunk): EventGroup {
  return {
    id: chunk.id,
    timestamp: new Date(chunk.startTime),
    message: chunk.rawMessages[0],
    eventData: chunk.eventData,
  };
}

function findLastAiBefore(items: ChatItem[], index: number): AIGroup | null {
  for (let i = index - 1; i >= 0; i--) {
    if (items[i].type === 'ai') return items[i].group as AIGroup;
  }
  return null;
}

function findFirstAiAfter(items: ChatItem[], index: number): AIGroup | null {
  for (let i = index + 1; i < items.length; i++) {
    if (items[i].type === 'ai') return items[i].group as AIGroup;
  }
  return null;
}
