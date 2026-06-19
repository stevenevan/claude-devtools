import type {
  ContextPhaseInfo,
  ContextInjection,
  ContextStats,
} from '@renderer/types/contextInjection';
import type { SessionConversation } from '@renderer/types/groups';

export interface ContextInjectionsForPhaseResult {
  allContextInjections: ContextInjection[];
  lastAiGroupTotalTokens: number | undefined;
}

export function computeContextInjectionsForPhase(args: {
  conversation: SessionConversation | null;
  contextStats: Map<string, ContextStats> | null;
  phaseInfo: ContextPhaseInfo | null;
  selectedPhase: number | null;
}): ContextInjectionsForPhaseResult {
  const { conversation, contextStats, phaseInfo, selectedPhase } = args;

  if (!contextStats || !conversation?.items.length) {
    return { allContextInjections: [], lastAiGroupTotalTokens: undefined };
  }

  let targetAiGroupId: string | undefined;
  if (selectedPhase !== null && phaseInfo) {
    const phase = phaseInfo.phases.find((p) => p.phaseNumber === selectedPhase);
    if (phase) {
      targetAiGroupId = phase.lastAIGroupId;
    }
  }

  if (!targetAiGroupId) {
    const lastAiItem = [...conversation.items].reverse().find((item) => item.type === 'ai');
    if (lastAiItem?.type !== 'ai') {
      return { allContextInjections: [], lastAiGroupTotalTokens: undefined };
    }
    targetAiGroupId = lastAiItem.group.id;
  }

  const stats = contextStats.get(targetAiGroupId);
  const injections = stats?.accumulatedInjections ?? [];

  let totalTokens: number | undefined;
  const targetItem = conversation.items.find(
    (item) => item.type === 'ai' && item.group.id === targetAiGroupId
  );
  if (targetItem?.type === 'ai') {
    const responses = targetItem.group.responses || [];
    for (let i = responses.length - 1; i >= 0; i--) {
      const msg = responses[i];
      if (msg.type === 'assistant' && msg.usage) {
        const usage = msg.usage;
        totalTokens =
          (usage.input_tokens ?? 0) +
          (usage.output_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0);
        break;
      }
    }
  }

  return { allContextInjections: injections, lastAiGroupTotalTokens: totalTokens };
}
