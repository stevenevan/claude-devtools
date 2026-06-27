

import type { TokenUsage } from './domain';

// Waterfall Chart Types

export interface WaterfallItem {

  id: string;

  label: string;

  startTime: Date;

  endTime: Date;

  durationMs: number;

  tokenUsage: TokenUsage;

  level: number;

  type: 'chunk' | 'subagent' | 'tool';

  isParallel: boolean;

  parentId?: string;

  groupId?: string;

  metadata?: {
    subagentType?: string;
    toolName?: string;
    messageCount?: number;
  };
}

export interface WaterfallData {

  items: WaterfallItem[];

  minTime: Date;

  maxTime: Date;

  totalDurationMs: number;
}
