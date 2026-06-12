import {
  detectClaudeMdFromFilePath,
  extractFileRefsFromResponses,
  extractReadToolPaths,
  extractUserMentionPaths,
} from './fileReferences';
import { createDirectoryInjection, createGlobalInjections } from './injectionFactory';
import { isAbsolutePath, joinPaths, normalizeForComparison } from './pathHelpers';

import type { ClaudeMdInjection, ClaudeMdStats } from '../../types/claudeMd';
import type { ClaudeMdFileInfo } from '../../types/data';
import type { AIGroup, ChatItem, UserGroup } from '../../types/groups';

interface ComputeClaudeMdStatsParams {
  aiGroup: AIGroup;
  userGroup: UserGroup | null;
  isFirstGroup: boolean;
  previousInjections: ClaudeMdInjection[];
  projectRoot: string;
  contextTokens: number;
  tokenData?: Record<string, ClaudeMdFileInfo>;
}

function computeClaudeMdStats(params: ComputeClaudeMdStatsParams): ClaudeMdStats {
  const {
    aiGroup,
    userGroup,
    isFirstGroup,
    previousInjections,
    projectRoot,
    contextTokens,
    tokenData,
  } = params;

  const newInjections: ClaudeMdInjection[] = [];
  const previousPaths = new Set(previousInjections.map((inj) => inj.path));

  // "ai-N" format for firstSeenInGroup enables turn navigation in SessionClaudeMdPanel
  const turnGroupId = `ai-${aiGroup.turnIndex}`;
  if (isFirstGroup) {
    const globalInjections = createGlobalInjections(projectRoot, turnGroupId, tokenData);
    for (const injection of globalInjections) {
      if (!previousPaths.has(injection.path)) {
        newInjections.push(injection);
        previousPaths.add(injection.path);
      }
    }
  }

  const allFilePaths: string[] = [];

  const readPaths = extractReadToolPaths(aiGroup.steps);
  allFilePaths.push(...readPaths);

  const mentionPaths = extractUserMentionPaths(userGroup, projectRoot);
  allFilePaths.push(...mentionPaths);

  // Extract from isMeta:true user messages in AI responses (slash command follow-ups)
  const responseRefs = extractFileRefsFromResponses(aiGroup.responses);
  for (const ref of responseRefs) {
    if (ref.path) {
      const absPath = isAbsolutePath(ref.path) ? ref.path : joinPaths(projectRoot, ref.path);
      allFilePaths.push(absPath);
    }
  }

  for (const filePath of allFilePaths) {
    const claudeMdPaths = detectClaudeMdFromFilePath(filePath, projectRoot);

    for (const claudeMdPath of claudeMdPaths) {
      if (previousPaths.has(claudeMdPath)) {
        continue;
      }

      // Skip if this is a global path (already handled)
      const isGlobalPath =
        normalizeForComparison(claudeMdPath) ===
          `${normalizeForComparison(projectRoot)}/CLAUDE.md` ||
        normalizeForComparison(claudeMdPath) ===
          `${normalizeForComparison(projectRoot)}/.claude/CLAUDE.md` ||
        normalizeForComparison(claudeMdPath) ===
          `${normalizeForComparison(projectRoot)}/CLAUDE.local.md`;

      if (isGlobalPath) {
        continue;
      }

      const injection = createDirectoryInjection(claudeMdPath, turnGroupId);
      newInjections.push(injection);
      previousPaths.add(claudeMdPath);
    }
  }

  const accumulatedInjections = [...previousInjections, ...newInjections];

  const totalEstimatedTokens = accumulatedInjections.reduce(
    (sum, inj) => sum + inj.estimatedTokens,
    0
  );

  const percentageOfContext = contextTokens > 0 ? (totalEstimatedTokens / contextTokens) * 100 : 0;

  return {
    newInjections,
    accumulatedInjections,
    totalEstimatedTokens,
    percentageOfContext,
    newCount: newInjections.length,
    accumulatedCount: accumulatedInjections.length,
  };
}

export function processSessionClaudeMd(
  items: ChatItem[],
  projectRoot: string,
  tokenData?: Record<string, ClaudeMdFileInfo>
): Map<string, ClaudeMdStats> {
  const statsMap = new Map<string, ClaudeMdStats>();
  let accumulatedInjections: ClaudeMdInjection[] = [];
  let isFirstAiGroup = true;
  let previousUserGroup: UserGroup | null = null;

  for (const item of items) {
    if (item.type === 'user') {
      previousUserGroup = item.group;
      continue;
    }

    // Handle compact items: reset accumulated state across compaction boundaries
    if (item.type === 'compact') {
      accumulatedInjections = [];
      isFirstAiGroup = true;
      previousUserGroup = null;
      continue;
    }

    // Process AI groups
    if (item.type === 'ai') {
      const aiGroup = item.group;

      // Input tokens as proxy for context window usage
      const contextTokens = aiGroup.tokens.input || 0;

      const stats = computeClaudeMdStats({
        aiGroup,
        userGroup: previousUserGroup,
        isFirstGroup: isFirstAiGroup,
        previousInjections: accumulatedInjections,
        projectRoot,
        contextTokens,
        tokenData,
      });

      statsMap.set(aiGroup.id, stats);

      accumulatedInjections = stats.accumulatedInjections;
      isFirstAiGroup = false;

      previousUserGroup = null;
    }
  }

  return statsMap;
}
