import { createLogger } from '@shared/utils/logger';

import { truncateText } from './stringUtils';

import type { ParsedMessage, PhaseTokenBreakdown, Process } from '../types/data';
import type { LinkedToolItem } from '../types/groups';

const logger = createLogger('Util:aiGroupHelpers');

// Handles both Date objects and ISO string timestamps from IPC serialization
export function toDate(timestamp: Date | string | number): Date {
  if (timestamp instanceof Date) {
    return timestamp;
  }
  return new Date(timestamp);
}

export function formatToolInput(input: Record<string, unknown>): string {
  try {
    const json = JSON.stringify(input, null, 2);
    return truncateText(json, 100);
  } catch (error) {
    logger.debug('formatToolInput failed:', error);
    return '[Invalid JSON]';
  }
}

export function formatToolResult(content: string | unknown[]): string {
  try {
    if (typeof content === 'string') {
      return truncateText(content, 200);
    }
    const json = JSON.stringify(content, null, 2);
    return truncateText(json, 200);
  } catch (error) {
    logger.debug('formatToolResult failed:', error);
    return '[Invalid content]';
  }
}

// Populates mainSessionImpact on each subagent: tokens from the Task tool_call + tool_result
// in the parent session, so SubagentItem can show both parent impact and subagent-internal usage.
export function attachMainSessionImpact(
  subagents: Process[],
  linkedTools: Map<string, LinkedToolItem>
): Process[] {
  for (const subagent of subagents) {
    if (subagent.parentTaskId) {
      const taskTool = linkedTools.get(subagent.parentTaskId);
      if (taskTool) {
        const callTokens = taskTool.callTokens ?? 0;
        const resultTokens = taskTool.result?.tokenCount ?? 0;
        subagent.mainSessionImpact = {
          callTokens,
          resultTokens,
          totalTokens: callTokens + resultTokens,
        };
      }
    }
  }
  return subagents;
}

// Mirrors the algorithm in src/main/utils/jsonl.ts:500-576.
// Tracks assistant input tokens across compaction events to compute per-phase contribution.
export function computeSubagentPhaseBreakdown(messages: ParsedMessage[]): {
  phases: PhaseTokenBreakdown[];
  totalConsumption: number;
  compactionCount: number;
} | null {
  let lastMainAssistantInputTokens = 0;
  let awaitingPostCompaction = false;
  const compactionPhases: { pre: number; post: number }[] = [];

  for (const msg of messages) {
    // Unlike jsonl.ts, don't filter by isSidechain — subagent messages all have isSidechain=true
    if (msg.type === 'assistant' && msg.model !== '<synthetic>') {
      const inputTokens =
        (msg.usage?.input_tokens ?? 0) +
        (msg.usage?.cache_read_input_tokens ?? 0) +
        (msg.usage?.cache_creation_input_tokens ?? 0);
      if (inputTokens > 0) {
        if (awaitingPostCompaction && compactionPhases.length > 0) {
          compactionPhases[compactionPhases.length - 1].post = inputTokens;
          awaitingPostCompaction = false;
        }
        lastMainAssistantInputTokens = inputTokens;
      }
    }

    // Detect compaction events
    if (msg.isCompactSummary) {
      compactionPhases.push({ pre: lastMainAssistantInputTokens, post: 0 });
      awaitingPostCompaction = true;
    }
  }

  if (lastMainAssistantInputTokens <= 0) {
    return null;
  }

  let phaseBreakdown: PhaseTokenBreakdown[];

  if (compactionPhases.length === 0) {
    phaseBreakdown = [
      {
        phaseNumber: 1,
        contribution: lastMainAssistantInputTokens,
        peakTokens: lastMainAssistantInputTokens,
      },
    ];
    return {
      phases: phaseBreakdown,
      totalConsumption: lastMainAssistantInputTokens,
      compactionCount: 0,
    };
  }

  phaseBreakdown = [];
  let total = 0;

  // Phase 1: tokens up to first compaction
  const phase1Contribution = compactionPhases[0].pre;
  total += phase1Contribution;
  phaseBreakdown.push({
    phaseNumber: 1,
    contribution: phase1Contribution,
    peakTokens: compactionPhases[0].pre,
    postCompaction: compactionPhases[0].post,
  });

  // Middle phases: contribution = pre[i] - post[i-1]
  for (let i = 1; i < compactionPhases.length; i++) {
    const contribution = compactionPhases[i].pre - compactionPhases[i - 1].post;
    total += contribution;
    phaseBreakdown.push({
      phaseNumber: i + 1,
      contribution,
      peakTokens: compactionPhases[i].pre,
      postCompaction: compactionPhases[i].post,
    });
  }

  // Last phase: final tokens - last post-compaction
  const lastPhase = compactionPhases[compactionPhases.length - 1];
  const lastContribution = lastMainAssistantInputTokens - lastPhase.post;
  total += lastContribution;
  phaseBreakdown.push({
    phaseNumber: compactionPhases.length + 1,
    contribution: lastContribution,
    peakTokens: lastMainAssistantInputTokens,
  });

  return {
    phases: phaseBreakdown,
    totalConsumption: total,
    compactionCount: compactionPhases.length,
  };
}
