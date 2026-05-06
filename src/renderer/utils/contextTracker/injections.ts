import { estimateTokens } from '@shared/utils/tokenFormatting';

import type { ClaudeMdInjection } from '../../types/claudeMd';
import type {
  ClaudeMdContextInjection,
  MentionedFileInjection,
  TaskCoordinationBreakdown,
  TaskCoordinationInjection,
  ThinkingTextBreakdown,
  ThinkingTextInjection,
  ToolOutputInjection,
  ToolTokenBreakdown,
  UserMessageInjection,
} from '../../types/contextInjection';
import type { AIGroupDisplayItem, LinkedToolItem, UserGroup } from '../../types/groups';

export const CATEGORY_MENTIONED_FILE = 'mentioned-file' as const;

export const TASK_COORDINATION_TOOL_NAMES = new Set([
  'SendMessage',
  'TeamCreate',
  'TeamDelete',
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TaskGet',
]);

function generateMentionedFileId(path: string): string {
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    const char = path.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  const positiveHash = Math.abs(hash).toString(16);
  return `mf-${positiveHash}`;
}

function generateToolOutputId(turnIndex: number): string {
  return `tool-output-ai-${turnIndex}`;
}

function generateThinkingTextId(turnIndex: number): string {
  return `thinking-text-ai-${turnIndex}`;
}

function generateTaskCoordinationId(turnIndex: number): string {
  return `task-coord-ai-${turnIndex}`;
}

function generateUserMessageId(turnIndex: number): string {
  return `user-msg-ai-${turnIndex}`;
}

export function wrapClaudeMdInjection(injection: ClaudeMdInjection): ClaudeMdContextInjection {
  return {
    ...injection,
    category: 'claude-md' as const,
  };
}

interface CreateMentionedFileInjectionParams {
  path: string;
  displayName: string;
  estimatedTokens: number;
  turnIndex: number;
  aiGroupId: string;
  exists?: boolean;
}

export function createMentionedFileInjection(
  params: CreateMentionedFileInjectionParams
): MentionedFileInjection {
  return {
    id: generateMentionedFileId(params.path),
    category: CATEGORY_MENTIONED_FILE,
    path: params.path,
    displayName: params.displayName,
    estimatedTokens: params.estimatedTokens,
    firstSeenTurnIndex: params.turnIndex,
    firstSeenInGroup: params.aiGroupId,
    exists: params.exists ?? true,
  };
}

export function aggregateToolOutputs(
  linkedTools: Map<string, LinkedToolItem>,
  turnIndex: number,
  aiGroupId: string,
  displayItems?: AIGroupDisplayItem[]
): ToolOutputInjection | null {
  const toolBreakdown: ToolTokenBreakdown[] = [];
  let totalTokens = 0;

  for (const linkedTool of linkedTools.values()) {
    if (TASK_COORDINATION_TOOL_NAMES.has(linkedTool.name)) {
      continue;
    }

    const callTokens = linkedTool.callTokens ?? 0;
    const resultTokens = linkedTool.result?.tokenCount ?? 0;
    const skillTokens = linkedTool.skillInstructionsTokenCount ?? 0;
    const toolTokenCount = callTokens + resultTokens + skillTokens;

    if (toolTokenCount > 0) {
      const displayName = linkedTool.name === 'Task' ? 'Task (Subagent)' : linkedTool.name;
      toolBreakdown.push({
        toolName: displayName,
        tokenCount: toolTokenCount,
        isError: linkedTool.result?.isError ?? false,
        toolUseId: linkedTool.id,
      });
      totalTokens += toolTokenCount;
    }
  }

  if (displayItems) {
    for (const item of displayItems) {
      if (item.type === 'slash' && item.slash.instructionsTokenCount) {
        toolBreakdown.push({
          toolName: `/${item.slash.name}`,
          tokenCount: item.slash.instructionsTokenCount,
          isError: false,
        });
        totalTokens += item.slash.instructionsTokenCount;
      }
    }
  }

  if (totalTokens === 0) {
    return null;
  }

  return {
    id: generateToolOutputId(turnIndex),
    category: 'tool-output',
    turnIndex,
    aiGroupId,
    estimatedTokens: totalTokens,
    toolCount: toolBreakdown.length,
    toolBreakdown,
  };
}

export function aggregateTaskCoordination(
  linkedTools: Map<string, LinkedToolItem>,
  turnIndex: number,
  aiGroupId: string,
  displayItems?: AIGroupDisplayItem[]
): TaskCoordinationInjection | null {
  const breakdown: TaskCoordinationBreakdown[] = [];
  let totalTokens = 0;

  for (const linkedTool of linkedTools.values()) {
    if (!TASK_COORDINATION_TOOL_NAMES.has(linkedTool.name)) {
      continue;
    }

    const callTokens = linkedTool.callTokens ?? 0;
    const resultTokens = linkedTool.result?.tokenCount ?? 0;
    const skillTokens = linkedTool.skillInstructionsTokenCount ?? 0;
    const toolTokenCount = callTokens + resultTokens + skillTokens;

    if (toolTokenCount > 0) {
      let label = linkedTool.name;
      if (linkedTool.name === 'SendMessage' && linkedTool.input) {
        const recipient = linkedTool.input.recipient as string | undefined;
        if (recipient) {
          label = `SendMessage → ${recipient}`;
        }
      }

      breakdown.push({
        type: linkedTool.name === 'SendMessage' ? 'send-message' : 'task-tool',
        toolName: linkedTool.name,
        tokenCount: toolTokenCount,
        label,
      });
      totalTokens += toolTokenCount;
    }
  }

  if (displayItems) {
    for (const item of displayItems) {
      if (item.type === 'teammate_message' && item.teammateMessage.tokenCount) {
        breakdown.push({
          type: 'teammate-message',
          tokenCount: item.teammateMessage.tokenCount,
          label: item.teammateMessage.teammateId,
        });
        totalTokens += item.teammateMessage.tokenCount;
      }
    }
  }

  if (totalTokens === 0) {
    return null;
  }

  return {
    id: generateTaskCoordinationId(turnIndex),
    category: 'task-coordination',
    turnIndex,
    aiGroupId,
    estimatedTokens: totalTokens,
    breakdown,
  };
}

export function createUserMessageInjection(
  userGroup: UserGroup,
  turnIndex: number,
  aiGroupId: string
): UserMessageInjection | null {
  const text = userGroup.content.rawText ?? userGroup.content.text ?? '';
  if (!text) return null;

  const tokens = estimateTokens(text);
  if (tokens === 0) return null;

  const textPreview = text.length > 80 ? text.slice(0, 80) + '…' : text;

  return {
    id: generateUserMessageId(turnIndex),
    category: 'user-message',
    turnIndex,
    aiGroupId,
    estimatedTokens: tokens,
    textPreview,
  };
}

export function aggregateThinkingText(
  displayItems: AIGroupDisplayItem[],
  turnIndex: number,
  aiGroupId: string
): ThinkingTextInjection | null {
  const breakdown: ThinkingTextBreakdown[] = [];
  let totalTokens = 0;
  let thinkingTokens = 0;
  let textTokens = 0;

  for (const item of displayItems) {
    if (item.type === 'thinking' && item.tokenCount && item.tokenCount > 0) {
      thinkingTokens += item.tokenCount;
      totalTokens += item.tokenCount;
    } else if (item.type === 'output' && item.tokenCount && item.tokenCount > 0) {
      textTokens += item.tokenCount;
      totalTokens += item.tokenCount;
    }
  }

  if (thinkingTokens > 0) {
    breakdown.push({ type: 'thinking', tokenCount: thinkingTokens });
  }
  if (textTokens > 0) {
    breakdown.push({ type: 'text', tokenCount: textTokens });
  }

  if (totalTokens === 0) {
    return null;
  }

  return {
    id: generateThinkingTextId(turnIndex),
    category: 'thinking-text',
    turnIndex,
    aiGroupId,
    estimatedTokens: totalTokens,
    breakdown,
  };
}
