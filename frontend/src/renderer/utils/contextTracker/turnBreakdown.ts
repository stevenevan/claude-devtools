import type { TokensByCategory } from '../../types/contextInjection';

export type ContextCategoryKey =
  | 'claudeMd'
  | 'mentionedFiles'
  | 'toolOutputs'
  | 'thinkingText'
  | 'taskCoordination'
  | 'userMessages';

export interface ContextCategoryEntry {
  category: ContextCategoryKey;
  tokens: number;
  sharePct: number;
}

export interface ContextTurnBreakdown {
  aiGroupId: string;
  turnIndex: number;
  totalTokens: number;
  dominantCategory: ContextCategoryKey | null;
  entries: ContextCategoryEntry[];
}

const CATEGORY_ORDER: ContextCategoryKey[] = [
  'claudeMd',
  'mentionedFiles',
  'toolOutputs',
  'thinkingText',
  'taskCoordination',
  'userMessages',
];

export function buildTurnBreakdown(
  aiGroupId: string,
  turnIndex: number,
  tokensByCategory: TokensByCategory
): ContextTurnBreakdown {
  const total =
    tokensByCategory.claudeMd +
    tokensByCategory.mentionedFiles +
    tokensByCategory.toolOutputs +
    tokensByCategory.thinkingText +
    tokensByCategory.taskCoordination +
    tokensByCategory.userMessages;

  const entries: ContextCategoryEntry[] = [];
  for (const category of CATEGORY_ORDER) {
    const tokens = tokensByCategory[category];
    if (tokens > 0) {
      entries.push({
        category,
        tokens,
        sharePct: total > 0 ? (tokens / total) * 100 : 0,
      });
    }
  }

  entries.sort((a, b) => b.tokens - a.tokens);

  return {
    aiGroupId,
    turnIndex,
    totalTokens: total,
    dominantCategory: entries[0]?.category ?? null,
    entries,
  };
}
