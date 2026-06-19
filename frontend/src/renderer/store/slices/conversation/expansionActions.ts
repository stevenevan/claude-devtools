import type { ConversationSlice } from './types';
import type { AIGroupExpansionLevel } from '@renderer/types/groups';

export function setAIGroupExpansionState(
  state: ConversationSlice,
  aiGroupId: string,
  level: AIGroupExpansionLevel
): Pick<ConversationSlice, 'aiGroupExpansionLevels'> {
  const newLevels = new Map(state.aiGroupExpansionLevels);
  newLevels.set(aiGroupId, level);
  return { aiGroupExpansionLevels: newLevels };
}

export function toggleStepExpansionState(
  state: ConversationSlice,
  stepId: string
): Pick<ConversationSlice, 'expandedStepIds'> {
  const newExpandedStepIds = new Set(state.expandedStepIds);
  if (newExpandedStepIds.has(stepId)) {
    newExpandedStepIds.delete(stepId);
  } else {
    newExpandedStepIds.add(stepId);
  }
  return { expandedStepIds: newExpandedStepIds };
}

export function toggleDisplayItemExpansionState(
  state: ConversationSlice,
  aiGroupId: string,
  itemId: string
): Pick<ConversationSlice, 'expandedDisplayItemIds'> {
  const newMap = new Map(state.expandedDisplayItemIds);
  const currentSet = newMap.get(aiGroupId) ?? new Set<string>();
  const newSet = new Set(currentSet);

  if (newSet.has(itemId)) {
    newSet.delete(itemId);
  } else {
    newSet.add(itemId);
  }

  newMap.set(aiGroupId, newSet);
  return { expandedDisplayItemIds: newMap };
}

export function toggleAIGroupExpansionState(
  state: ConversationSlice,
  aiGroupId: string
): Pick<ConversationSlice, 'expandedAIGroupIds'> {
  const newSet = new Set(state.expandedAIGroupIds);
  if (newSet.has(aiGroupId)) {
    newSet.delete(aiGroupId);
  } else {
    newSet.add(aiGroupId);
  }
  return { expandedAIGroupIds: newSet };
}

export function getExpandedDisplayItemIdsFromState(
  state: ConversationSlice,
  aiGroupId: string
): Set<string> {
  return state.expandedDisplayItemIds.get(aiGroupId) ?? new Set<string>();
}
