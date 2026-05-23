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

/**
 * Parameters for computing CLAUDE.md stats for an AI group.
 */
interface ComputeClaudeMdStatsParams {
  aiGroup: AIGroup;
  userGroup: UserGroup | null;
  isFirstGroup: boolean;
  previousInjections: ClaudeMdInjection[];
  projectRoot: string;
  contextTokens: number;
  tokenData?: Record<string, ClaudeMdFileInfo>;
}

/**
 * Compute CLAUDE.md injection statistics for an AI group.
 */
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

  // For the first group, add global injections
  // Use "ai-N" format for firstSeenInGroup to enable turn navigation in SessionClaudeMdPanel
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

  // Collect all file paths from Read tools and user @ mentions
  const allFilePaths: string[] = [];

  // Extract from Read tool calls in semantic steps
  const readPaths = extractReadToolPaths(aiGroup.steps);
  allFilePaths.push(...readPaths);

  // Extract from user @ mentions
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

  // For each file path, detect potential CLAUDE.md files
  for (const filePath of allFilePaths) {
    const claudeMdPaths = detectClaudeMdFromFilePath(filePath, projectRoot);

    for (const claudeMdPath of claudeMdPaths) {
      // Skip if already seen
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

      // Create directory injection
      const injection = createDirectoryInjection(claudeMdPath, turnGroupId);
      newInjections.push(injection);
      previousPaths.add(claudeMdPath);
    }
  }

  // Build accumulated injections
  const accumulatedInjections = [...previousInjections, ...newInjections];

  // Calculate totals
  const totalEstimatedTokens = accumulatedInjections.reduce(
    (sum, inj) => sum + inj.estimatedTokens,
    0
  );

  // Calculate percentage of context
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

/**
 * Process all chat items in a session and compute CLAUDE.md stats for each AI group.
 * Returns a map of aiGroupId -> ClaudeMdStats.
 */
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
    // Track user groups for pairing with subsequent AI groups
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

      // Get context tokens from the AI group's metrics
      // Use input tokens as a proxy for context window usage
      const contextTokens = aiGroup.tokens.input || 0;

      // Compute stats for this group
      const stats = computeClaudeMdStats({
        aiGroup,
        userGroup: previousUserGroup,
        isFirstGroup: isFirstAiGroup,
        previousInjections: accumulatedInjections,
        projectRoot,
        contextTokens,
        tokenData,
      });

      // Store stats
      statsMap.set(aiGroup.id, stats);

      // Update accumulated state for next iteration
      accumulatedInjections = stats.accumulatedInjections;
      isFirstAiGroup = false;

      // Clear the user group pairing after processing
      previousUserGroup = null;
    }
  }

  return statsMap;
}
