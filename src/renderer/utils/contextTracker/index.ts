// NOTE: one-off exception to "renderer utils have no barrel exports" — 3 external callers
// already import from `@renderer/utils/contextTracker`; directory split preserves their contract.

import { MAX_MENTIONED_FILE_TOKENS } from '../../types/contextInjection';
import {
  createGlobalInjections,
  detectClaudeMdFromFilePath,
  extractFileRefsFromResponses,
  extractReadToolPaths,
  extractUserMentionPaths,
} from '../claudeMd';

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

interface ComputeContextStatsParams {
  aiGroup: AIGroup;
  userGroup: UserGroup | null;
  linkedTools: Map<string, LinkedToolItem>;
  displayItems?: AIGroupDisplayItem[];
  isFirstGroup: boolean;
  previousInjections: ContextInjection[];
  projectRoot: string;
  claudeMdTokenData?: Record<string, ClaudeMdFileInfo>;
  mentionedFileTokenData?: Map<string, MentionedFileInfo>;
  /** Token data for validated directory CLAUDE.md files (keyed by full path) */
  directoryTokenData?: Record<string, ClaudeMdFileInfo>;
}

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

  // "ai-N" format for firstSeenInGroup enables turn navigation
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

  // b) Detect directory CLAUDE.md from file paths (only validated-to-exist files)
  const allFilePaths: string[] = [];

  const readPaths = extractReadToolPaths(aiGroup.steps);
  allFilePaths.push(...readPaths);

  const mentionPaths = extractUserMentionPaths(userGroup, projectRoot);
  allFilePaths.push(...mentionPaths);

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

      // Only include directory CLAUDE.md files that exist (validated via directoryTokenData)
      // If directoryTokenData is provided and doesn't contain this path, the file doesn't exist
      if (directoryTokenData) {
        const fileInfo = directoryTokenData[claudeMdPath];
        if (!fileInfo || !fileInfo.exists || fileInfo.estimatedTokens <= 0) {
          continue;
        }
        const injection = createDirectoryInjection(claudeMdPath, turnGroupId);
        injection.estimatedTokens = fileInfo.estimatedTokens;
        newInjections.push(wrapClaudeMdInjection(injection));
        previousPaths.add(claudeMdPath);
      } else {
        // Fallback: no directoryTokenData provided — use default tokens (legacy behavior)
        const injection = createDirectoryInjection(claudeMdPath, turnGroupId);
        newInjections.push(wrapClaudeMdInjection(injection));
        previousPaths.add(claudeMdPath);
      }
    }
  }

  // c) Process mentioned files
  if (userGroup?.content.fileReferences) {
    for (const fileRef of userGroup.content.fileReferences) {
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
  }

  // c2) @-mentions from isMeta:true user messages in AI responses (slash command follow-ups)
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

  // d) Aggregate tool outputs (task coordination excluded — tracked in d2)
  const toolOutputInjection = aggregateToolOutputs(
    linkedTools,
    aiGroup.turnIndex,
    turnGroupId,
    displayItems
  );
  if (toolOutputInjection) {
    newInjections.push(toolOutputInjection);
  }

  // d2) Task coordination tokens (SendMessage, TeamCreate, TaskCreate, etc.)
  const taskCoordinationInjection = aggregateTaskCoordination(
    linkedTools,
    aiGroup.turnIndex,
    turnGroupId,
    displayItems
  );
  if (taskCoordinationInjection) {
    newInjections.push(taskCoordinationInjection);
  }

  // d3) User message injection
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

  // g) Totals and category breakdowns
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
