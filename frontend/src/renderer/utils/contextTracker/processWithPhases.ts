import { buildDisplayItems } from '../displayItemBuilder';
import { findLastOutput } from '../lastOutputDetector';
import { linkToolCallsToResults } from '../toolLinkingEngine';

import { computeContextStats } from '.';

import type {
  CompactionTokenDelta,
  ContextInjection,
  ContextPhase,
  ContextPhaseInfo,
  ContextStats,
  MentionedFileInfo,
} from '../../types/contextInjection';
import type { ClaudeMdFileInfo } from '../../types/data';
import type {
  AIGroup,
  AIGroupDisplayItem,
  ChatItem,
  LinkedToolItem,
  UserGroup,
} from '../../types/groups';

function getLastAssistantTotalTokens(aiGroup: AIGroup): number | undefined {
  const responses = aiGroup.responses || [];
  for (let i = responses.length - 1; i >= 0; i--) {
    const msg = responses[i];
    if (msg.type === 'assistant' && msg.usage) {
      return (
        (msg.usage.input_tokens ?? 0) +
        (msg.usage.output_tokens ?? 0) +
        (msg.usage.cache_read_input_tokens ?? 0) +
        (msg.usage.cache_creation_input_tokens ?? 0)
      );
    }
  }
  return undefined;
}

function getFirstAssistantTotalTokens(aiGroup: AIGroup): number | undefined {
  const responses = aiGroup.responses || [];
  for (const msg of responses) {
    if (msg.type === 'assistant' && msg.usage) {
      return (
        (msg.usage.input_tokens ?? 0) +
        (msg.usage.output_tokens ?? 0) +
        (msg.usage.cache_read_input_tokens ?? 0) +
        (msg.usage.cache_creation_input_tokens ?? 0)
      );
    }
  }
  return undefined;
}

export function processSessionContextWithPhases(
  items: ChatItem[],
  projectRoot: string,
  claudeMdTokenData?: Record<string, ClaudeMdFileInfo>,
  mentionedFileTokenData?: Map<string, MentionedFileInfo>,
  directoryTokenData?: Record<string, ClaudeMdFileInfo>
): { statsMap: Map<string, ContextStats>; phaseInfo: ContextPhaseInfo } {
  const statsMap = new Map<string, ContextStats>();
  let accumulatedInjections: ContextInjection[] = [];
  let isFirstAiGroup = true;
  let previousUserGroup: UserGroup | null = null;

  let currentPhaseNumber = 1;
  const phases: ContextPhase[] = [];
  const aiGroupPhaseMap = new Map<string, number>();
  const compactionTokenDeltas = new Map<string, CompactionTokenDelta>();

  let currentPhaseFirstAIGroupId: string | null = null;
  let currentPhaseLastAIGroupId: string | null = null;
  let currentPhaseCompactGroupId: string | null = null;
  let lastAIGroupBeforeCompact: AIGroup | null = null;

  for (const item of items) {
    if (item.type === 'user') {
      previousUserGroup = item.group;
      continue;
    }

    if (item.type === 'compact') {
      if (currentPhaseFirstAIGroupId && currentPhaseLastAIGroupId) {
        phases.push({
          phaseNumber: currentPhaseNumber,
          firstAIGroupId: currentPhaseFirstAIGroupId,
          lastAIGroupId: currentPhaseLastAIGroupId,
          compactGroupId: currentPhaseCompactGroupId,
        });
      }

      accumulatedInjections = [];
      isFirstAiGroup = true;
      previousUserGroup = null;

      currentPhaseNumber++;
      currentPhaseCompactGroupId = item.group.id;
      currentPhaseFirstAIGroupId = null;
      currentPhaseLastAIGroupId = null;

      continue;
    }

    if (item.type === 'ai') {
      const aiGroup = item.group;

      interface EnhancedAIGroupProps {
        linkedTools?: Map<string, LinkedToolItem>;
        displayItems?: AIGroupDisplayItem[];
      }
      let linkedTools = (aiGroup as AIGroup & EnhancedAIGroupProps).linkedTools;
      if (!linkedTools || linkedTools.size === 0) {
        linkedTools = linkToolCallsToResults(aiGroup.steps, aiGroup.responses);
      }

      let displayItems = (aiGroup as AIGroup & EnhancedAIGroupProps).displayItems;
      if (!displayItems && aiGroup.steps && aiGroup.steps.length > 0) {
        const lastOutput = findLastOutput(aiGroup.steps, aiGroup.isOngoing ?? false);
        displayItems = buildDisplayItems(
          aiGroup.steps,
          lastOutput,
          aiGroup.processes || [],
          aiGroup.responses
        );
      }

      const stats = computeContextStats({
        aiGroup,
        userGroup: previousUserGroup,
        linkedTools,
        displayItems,
        isFirstGroup: isFirstAiGroup,
        previousInjections: accumulatedInjections,
        projectRoot,
        claudeMdTokenData,
        mentionedFileTokenData,
        directoryTokenData,
      });

      stats.phaseNumber = currentPhaseNumber;

      if (isFirstAiGroup && currentPhaseCompactGroupId && lastAIGroupBeforeCompact) {
        const preTokens = getLastAssistantTotalTokens(lastAIGroupBeforeCompact);
        const postTokens = getFirstAssistantTotalTokens(aiGroup);
        if (preTokens !== undefined && postTokens !== undefined) {
          compactionTokenDeltas.set(currentPhaseCompactGroupId, {
            preCompactionTokens: preTokens,
            postCompactionTokens: postTokens,
            delta: postTokens - preTokens,
          });
        }
      }

      statsMap.set(aiGroup.id, stats);

      aiGroupPhaseMap.set(aiGroup.id, currentPhaseNumber);
      if (!currentPhaseFirstAIGroupId) {
        currentPhaseFirstAIGroupId = aiGroup.id;
      }
      currentPhaseLastAIGroupId = aiGroup.id;
      lastAIGroupBeforeCompact = aiGroup;

      accumulatedInjections = stats.accumulatedInjections;
      isFirstAiGroup = false;
      previousUserGroup = null;
    }
  }

  if (currentPhaseFirstAIGroupId && currentPhaseLastAIGroupId) {
    phases.push({
      phaseNumber: currentPhaseNumber,
      firstAIGroupId: currentPhaseFirstAIGroupId,
      lastAIGroupId: currentPhaseLastAIGroupId,
      compactGroupId: currentPhaseCompactGroupId,
    });
  }

  const phaseInfo: ContextPhaseInfo = {
    phases,
    compactionCount: currentPhaseNumber - 1,
    aiGroupPhaseMap,
    compactionTokenDeltas,
  };

  return { statsMap, phaseInfo };
}
