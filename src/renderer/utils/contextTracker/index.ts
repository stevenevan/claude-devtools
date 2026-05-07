/**
 * Unified Context Tracker — directory barrel.
 *
 * NOTE: this is a one-off exception to the "renderer utils have no barrel exports"
 * convention. Justified because 3 external callers already import from
 * `@renderer/utils/contextTracker` and the directory split preserves their
 * import contract atomically. Do not generalize this pattern to other utils.
 */

import { MAX_MENTIONED_FILE_TOKENS } from '../../types/contextInjection';
import {
  createGlobalInjections,
  detectClaudeMdFromFilePath,
  extractFileRefsFromResponses,
  extractReadToolPaths,
  extractUserMentionPaths,
} from '../claudeMdTracker';

import {
  CATEGORY_MENTIONED_FILE,
  aggregateTaskCoordination,
  aggregateThinkingText,
  aggregateToolOutputs,
  createMentionedFileInjection,
  createUserMessageInjection,
  wrapClaudeMdInjection,
} from './injections';
import {
  createDirectoryInjection,
  isAbsolutePath,
  joinPaths,
  normalizeForComparison,
} from './pathHelpers';

import type {
  ClaudeMdContextInjection,
  ContextInjection,
  ContextStats,
  MentionedFileInfo,
  MentionedFileInjection,
  NewCountsByCategory,
  TokensByCategory,
} from '../../types/contextInjection';
import type { ClaudeMdFileInfo } from '../../types/data';
import type { AIGroup, AIGroupDisplayItem, LinkedToolItem, UserGroup } from '../../types/groups';

export { processSessionContextWithPhases } from './processWithPhases';
export {
  buildTurnBreakdown,
  type ContextCategoryEntry,
  type ContextCategoryKey,
  type ContextTurnBreakdown,
} from './turnBreakdown';

// Stats Computation

/**
 * Parameters for computing context stats for an AI group.
 */
interface ComputeContextStatsParams {
  /** The AI group being processed */
  aiGroup: AIGroup;
  /** The preceding user group (if any) */
  userGroup: UserGroup | null;
  /** Linked tools map from the enhanced AI group */
  linkedTools: Map<string, LinkedToolItem>;
  /** Display items from enhanced AI group (includes user skills) */
  displayItems?: AIGroupDisplayItem[];
  /** Whether this is the first AI group in the session */
  isFirstGroup: boolean;
  /** Accumulated injections from previous groups */
  previousInjections: ContextInjection[];
  /** Project root path for resolving relative paths */
  projectRoot: string;
  /** Token data for CLAUDE.md files (global sources) */
  claudeMdTokenData?: Record<string, ClaudeMdFileInfo>;
  /** Token data for mentioned files */
  mentionedFileTokenData?: Map<string, MentionedFileInfo>;
  /** Token data for validated directory CLAUDE.md files (keyed by full path) */
  directoryTokenData?: Record<string, ClaudeMdFileInfo>;
}

/**
 * Compute context stats for an AI group.
 * Tracks CLAUDE.md injections, mentioned files, and tool outputs.
 */
export function computeContextStats(params: ComputeContextStatsParams): ContextStats {
  const {
    aiGroup,
    userGroup,
    linkedTools,
    displayItems,
    isFirstGroup,
    previousInjections,
    projectRoot,
    claudeMdTokenData,
    mentionedFileTokenData,
    directoryTokenData,
  } = params;

  const newInjections: ContextInjection[] = [];
  const previousPaths = new Set(
    previousInjections
      .filter(
        (inj): inj is ClaudeMdContextInjection | MentionedFileInjection =>
          inj.category === 'claude-md' || inj.category === CATEGORY_MENTIONED_FILE
      )
      .map((inj) => inj.path)
  );

  // Use "ai-N" format for firstSeenInGroup to enable turn navigation
  const turnGroupId = `ai-${aiGroup.turnIndex}`;

  // a) For FIRST group only: Add CLAUDE.md global injections
  if (isFirstGroup) {
    const globalInjections = createGlobalInjections(projectRoot, turnGroupId, claudeMdTokenData);
    for (const injection of globalInjections) {
      if (!previousPaths.has(injection.path)) {
        newInjections.push(wrapClaudeMdInjection(injection));
        previousPaths.add(injection.path);
      }
    }
  }

  // b) Detect directory CLAUDE.md from file paths
  // Only include directory CLAUDE.md files that have been validated to exist
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

      // Only include directory CLAUDE.md files that exist (validated via directoryTokenData)
      // If directoryTokenData is provided and doesn't contain this path, the file doesn't exist
      if (directoryTokenData) {
        const fileInfo = directoryTokenData[claudeMdPath];
        if (!fileInfo || !fileInfo.exists || fileInfo.estimatedTokens <= 0) {
          // File doesn't exist or has no content - skip it
          continue;
        }
        // Use validated token count from directoryTokenData
        const injection = createDirectoryInjection(claudeMdPath, turnGroupId);
        injection.estimatedTokens = fileInfo.estimatedTokens;
        newInjections.push(wrapClaudeMdInjection(injection));
        previousPaths.add(claudeMdPath);
      } else {
        // Fallback: if no directoryTokenData provided, create with default tokens (legacy behavior)
        const injection = createDirectoryInjection(claudeMdPath, turnGroupId);
        newInjections.push(wrapClaudeMdInjection(injection));
        previousPaths.add(claudeMdPath);
      }
    }
  }

  // c) Process mentioned files (NEW LOGIC)
  if (userGroup?.content.fileReferences) {
    for (const fileRef of userGroup.content.fileReferences) {
      if (!fileRef.path) continue;

      // Convert to absolute path if needed
      const absolutePath = isAbsolutePath(fileRef.path)
        ? fileRef.path
        : joinPaths(projectRoot, fileRef.path);

      // Skip if already seen
      if (previousPaths.has(absolutePath)) {
        continue;
      }

      // Check if we have token data for this file
      const fileInfo = mentionedFileTokenData?.get(absolutePath);

      // Only include files that exist and are under the token limit
      if (fileInfo?.exists && fileInfo.estimatedTokens <= MAX_MENTIONED_FILE_TOKENS) {
        const mentionedFileInjection = createMentionedFileInjection({
          path: absolutePath,
          displayName: fileRef.path, // Use original path for display
          estimatedTokens: fileInfo.estimatedTokens,
          turnIndex: aiGroup.turnIndex,
          aiGroupId: turnGroupId,
          exists: fileInfo.exists,
        });

        newInjections.push(mentionedFileInjection);
        previousPaths.add(absolutePath);
      }
    }
  }

  // c2) Process @-mentions from isMeta:true user messages in AI responses
  for (const fileRef of responseRefs) {
    if (!fileRef.path) continue;

    const absolutePath = isAbsolutePath(fileRef.path)
      ? fileRef.path
      : joinPaths(projectRoot, fileRef.path);

    if (previousPaths.has(absolutePath)) {
      continue;
    }

    const fileInfo = mentionedFileTokenData?.get(absolutePath);

    if (fileInfo?.exists && fileInfo.estimatedTokens <= MAX_MENTIONED_FILE_TOKENS) {
      const mentionedFileInjection = createMentionedFileInjection({
        path: absolutePath,
        displayName: fileRef.path,
        estimatedTokens: fileInfo.estimatedTokens,
        turnIndex: aiGroup.turnIndex,
        aiGroupId: turnGroupId,
        exists: fileInfo.exists,
      });

      newInjections.push(mentionedFileInjection);
      previousPaths.add(absolutePath);
    }
  }

  // d) Aggregate tool outputs (includes user-invoked skill tokens from displayItems)
  //    Task coordination tools are excluded here (tracked separately in step d2)
  const toolOutputInjection = aggregateToolOutputs(
    linkedTools,
    aiGroup.turnIndex,
    turnGroupId,
    displayItems
  );
  if (toolOutputInjection) {
    newInjections.push(toolOutputInjection);
  }

  // d2) Aggregate task coordination tokens (SendMessage, TeamCreate, TaskCreate, etc.)
  const taskCoordinationInjection = aggregateTaskCoordination(
    linkedTools,
    aiGroup.turnIndex,
    turnGroupId,
    displayItems
  );
  if (taskCoordinationInjection) {
    newInjections.push(taskCoordinationInjection);
  }

  // d3) Create user message injection
  if (userGroup) {
    const userMessageInjection = createUserMessageInjection(
      userGroup,
      aiGroup.turnIndex,
      turnGroupId
    );
    if (userMessageInjection) {
      newInjections.push(userMessageInjection);
    }
  }

  // e) Aggregate thinking and text output tokens
  if (displayItems) {
    const thinkingTextInjection = aggregateThinkingText(
      displayItems,
      aiGroup.turnIndex,
      turnGroupId
    );
    if (thinkingTextInjection) {
      newInjections.push(thinkingTextInjection);
    }
  }

  // f) Build accumulated injections
  const accumulatedInjections = [...previousInjections, ...newInjections];

  // g) Calculate totals and category breakdowns
  const tokensByCategory: TokensByCategory = {
    claudeMd: 0,
    mentionedFiles: 0,
    toolOutputs: 0,
    thinkingText: 0,
    taskCoordination: 0,
    userMessages: 0,
  };

  const newCounts: NewCountsByCategory = {
    claudeMd: 0,
    mentionedFiles: 0,
    toolOutputs: 0,
    thinkingText: 0,
    taskCoordination: 0,
    userMessages: 0,
  };

  // Count new injections by category
  for (const injection of newInjections) {
    switch (injection.category) {
      case 'claude-md':
        newCounts.claudeMd++;
        break;
      case CATEGORY_MENTIONED_FILE:
        newCounts.mentionedFiles++;
        break;
      case 'tool-output':
        newCounts.toolOutputs += injection.toolCount;
        break;
      case 'thinking-text':
        newCounts.thinkingText++;
        break;
      case 'task-coordination':
        newCounts.taskCoordination += injection.breakdown.length;
        break;
      case 'user-message':
        newCounts.userMessages++;
        break;
    }
  }

  // Sum tokens by category from accumulated injections
  for (const injection of accumulatedInjections) {
    switch (injection.category) {
      case 'claude-md':
        tokensByCategory.claudeMd += injection.estimatedTokens;
        break;
      case CATEGORY_MENTIONED_FILE:
        tokensByCategory.mentionedFiles += injection.estimatedTokens;
        break;
      case 'tool-output':
        tokensByCategory.toolOutputs += injection.estimatedTokens;
        break;
      case 'thinking-text':
        tokensByCategory.thinkingText += injection.estimatedTokens;
        break;
      case 'task-coordination':
        tokensByCategory.taskCoordination += injection.estimatedTokens;
        break;
      case 'user-message':
        tokensByCategory.userMessages += injection.estimatedTokens;
        break;
    }
  }

  const totalEstimatedTokens =
    tokensByCategory.claudeMd +
    tokensByCategory.mentionedFiles +
    tokensByCategory.toolOutputs +
    tokensByCategory.thinkingText +
    tokensByCategory.taskCoordination +
    tokensByCategory.userMessages;

  return {
    newInjections,
    accumulatedInjections,
    totalEstimatedTokens,
    tokensByCategory,
    newCounts,
  };
}
