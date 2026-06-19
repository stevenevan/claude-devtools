import { attachMainSessionImpact } from './aiGroupHelpers';
import { buildDisplayItems } from './displayItemBuilder';
import { buildSummary } from './displaySummary';
import { findLastOutput } from './lastOutputDetector';
import { extractMainModel, extractSubagentModels } from './modelExtractor';
import { type PrecedingSlashInfo } from './slashCommandExtractor';
import { linkToolCallsToResults } from './toolLinkingEngine';

import type { ClaudeMdStats } from '../types/claudeMd';
import type { AIGroup, EnhancedAIGroup } from '../types/groups';

export function enhanceAIGroup(
  aiGroup: AIGroup,
  claudeMdStats?: ClaudeMdStats,
  precedingSlash?: PrecedingSlashInfo
): EnhancedAIGroup {
  const lastOutput = findLastOutput(aiGroup.steps, aiGroup.isOngoing ?? false);
  const linkedTools = linkToolCallsToResults(aiGroup.steps, aiGroup.responses);
  attachMainSessionImpact(aiGroup.processes, linkedTools);
  const displayItems = buildDisplayItems(
    aiGroup.steps,
    lastOutput,
    aiGroup.processes,
    aiGroup.responses,
    precedingSlash
  );
  const summary = buildSummary(displayItems);
  const mainModel = extractMainModel(aiGroup.steps);
  const subagentModels = extractSubagentModels(aiGroup.processes, mainModel);

  return {
    ...aiGroup,
    lastOutput,
    linkedTools,
    displayItems,
    itemsSummary: summary,
    mainModel,
    subagentModels,
    claudeMdStats: claudeMdStats ?? null,
  };
}
