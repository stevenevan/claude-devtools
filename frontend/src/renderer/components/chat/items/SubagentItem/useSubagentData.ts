import React, { useMemo } from 'react';

import { getSubagentTypeColorSet, getTeamColorSet } from '@renderer/constants/teamColors';
import { useTabUI } from '@renderer/hooks/useTabUI';
import { useStore } from '@renderer/store';
import { buildDisplayItemsFromMessages } from '@renderer/utils/displayItemBuilder';
import { buildSummary } from '@renderer/utils/displaySummary';
import { computeSubagentPhaseBreakdown } from '@renderer/utils/aiGroupHelpers';
import { getHighlightProps, type TriggerColor } from '@shared/constants/triggerColors';
import { parseModelString } from '@shared/utils/modelParser';

import type { ParsedMessage, Process, SemanticStep } from '@renderer/types/data';

interface UseSubagentDataArgs {
  step: SemanticStep;
  subagent: Process;
  isExpanded: boolean;
  highlightToolUseId?: string;
  highlightColor?: TriggerColor;
}

interface SubagentData {
  subagentType: string;
  truncatedDesc: string;
  teamColors: ReturnType<typeof getTeamColorSet> | null;
  typeColors: ReturnType<typeof getSubagentTypeColorSet> | null;
  isShutdownOnly: boolean;
  toggleSubagentTraceExpansion: (subagentId: string) => void;
  displayItems: ReturnType<typeof buildDisplayItemsFromMessages>;
  itemsSummary: string;
  modelInfo: ReturnType<typeof parseModelString> | null;
  lastUsage: ParsedMessage['usage'] | null;
  phaseData: ReturnType<typeof computeSubagentPhaseBreakdown>;
  searchCurrentSubagentItemId: string | null;
  shouldExpandForSearch: boolean;
  isTraceExpanded: boolean;
  outerHighlight: { className: string; style?: React.CSSProperties | undefined };
  cumulativeMetrics?: { outputTokens: number; turnCount: number };
  hasMainImpact: boolean | undefined;
  hasIsolated: boolean | null | undefined;
  isMultiPhase: boolean;
  isolatedTotal: number;
}

export const useSubagentData = ({
  step,
  subagent,
  isExpanded,
  highlightToolUseId,
  highlightColor,
}: UseSubagentDataArgs): SubagentData => {
  const description = subagent.description ?? step.content.subagentDescription ?? 'Subagent';
  const subagentType = subagent.subagentType ?? 'Task';
  const truncatedDesc = description.length > 60 ? description.slice(0, 60) + '...' : description;

  // Agent configs from .claude/agents/ for color lookup
  const agentConfigs = useStore((s) => s.agentConfigs);

  // Team member colors (when this subagent is a team member)
  const teamColors = subagent.team ? getTeamColorSet(subagent.team.memberColor) : null;
  // Type-based colors for non-team subagents (from agent config or deterministic hash)
  const typeColors = !teamColors ? getSubagentTypeColorSet(subagentType, agentConfigs) : null;

  // Detect shutdown-only team activations (trivial: just a shutdown_response)
  const isShutdownOnly = useMemo(() => {
    if (!subagent.team || !subagent.messages?.length) return false;
    const assistantMsgs = subagent.messages.filter((m) => m.type === 'assistant');
    if (assistantMsgs.length !== 1) return false;
    const calls = assistantMsgs[0].toolCalls ?? [];
    return (
      calls.length === 1 &&
      calls[0].name === 'SendMessage' &&
      calls[0].input?.type === 'shutdown_response'
    );
  }, [subagent.team, subagent.messages]);

  // Per-tab trace expansion state (replaces local useState for true per-tab isolation)
  const { isSubagentTraceExpanded, toggleSubagentTraceExpansion } = useTabUI();
  const isTraceManuallyExpanded = isSubagentTraceExpanded(subagent.id);

  // Check if contains highlighted error
  // Also matches when the highlight targets the parent Task tool_use that spawned this subagent
  const containsHighlightedError = useMemo(() => {
    if (!highlightToolUseId) return false;
    // Match parent Task tool_use ID (trigger matched the Task call itself)
    if (subagent.parentTaskId === highlightToolUseId) return true;
    // Match inner tool calls/results within the subagent
    if (!subagent.messages) return false;
    for (const msg of subagent.messages) {
      if (msg.toolCalls?.some((tc) => tc.id === highlightToolUseId)) return true;
      if (msg.toolResults?.some((tr) => tr.toolUseId === highlightToolUseId)) return true;
    }
    return false;
  }, [highlightToolUseId, subagent.parentTaskId, subagent.messages]);

  // Build display items
  const displayItems = useMemo(() => {
    if ((!isExpanded && !containsHighlightedError) || !subagent.messages?.length) {
      return [];
    }
    return buildDisplayItemsFromMessages(subagent.messages, []);
  }, [isExpanded, containsHighlightedError, subagent.messages]);

  // Build summary
  const itemsSummary = useMemo(() => {
    if (!isExpanded && !containsHighlightedError) {
      const toolCount =
        subagent.messages?.filter(
          (m) =>
            m.type === 'assistant' &&
            Array.isArray(m.content) &&
            m.content.some((b) => b.type === 'tool_use')
        ).length ?? 0;
      return toolCount > 0 ? `${toolCount} tools` : '';
    }
    return buildSummary(displayItems);
  }, [isExpanded, containsHighlightedError, displayItems, subagent.messages]);

  // Model info
  const modelInfo = useMemo(() => {
    const msg = subagent.messages?.find(
      (m) => m.type === 'assistant' && m.model && m.model !== '<synthetic>'
    );
    return msg?.model ? parseModelString(msg.model) : null;
  }, [subagent.messages]);

  // Last usage
  const lastUsage = useMemo(() => {
    const messages = subagent.messages ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].type === 'assistant' && messages[i].usage) {
        return messages[i].usage;
      }
    }
    return null;
  }, [subagent.messages]);

  // Multi-phase context breakdown (for subagents with compaction)
  const phaseData = useMemo(() => {
    if (!subagent.messages?.length) return null;
    return computeSubagentPhaseBreakdown(subagent.messages);
  }, [subagent.messages]);

  // Search expansion
  const searchExpandedSubagentIds = useStore((s) => s.searchExpandedSubagentIds);
  const searchCurrentSubagentItemId = useStore((s) => s.searchCurrentSubagentItemId);
  const shouldExpandForSearch = searchExpandedSubagentIds.has(subagent.id);

  // Combine manual expansion with auto-expansion for errors/search
  const isTraceExpanded =
    isTraceManuallyExpanded || containsHighlightedError || shouldExpandForSearch;

  // Outer card highlight when this subagent contains the highlighted tool
  const outerHighlight = useMemo(() => {
    if (!containsHighlightedError)
      return { className: '', style: undefined as React.CSSProperties | undefined };
    return getHighlightProps(highlightColor);
  }, [containsHighlightedError, highlightColor]);

  // Cumulative metrics for team members — show total output generated
  const cumulativeMetrics = useMemo(() => {
    if (!subagent.team || !subagent.metrics) return undefined;
    const turnCount =
      subagent.messages?.filter((m) => m.type === 'assistant' && m.usage).length ?? 0;
    return {
      outputTokens: subagent.metrics.outputTokens,
      turnCount,
    };
  }, [subagent.team, subagent.metrics, subagent.messages]);

  // Computed values for metrics
  const hasMainImpact = subagent.mainSessionImpact && subagent.mainSessionImpact.totalTokens > 0;
  const hasIsolated = lastUsage && lastUsage.input_tokens + lastUsage.output_tokens > 0;
  const isMultiPhase = phaseData != null && phaseData.compactionCount > 0;
  const isolatedTotal = isMultiPhase
    ? phaseData.totalConsumption
    : lastUsage
      ? lastUsage.input_tokens +
        lastUsage.output_tokens +
        (lastUsage.cache_read_input_tokens ?? 0) +
        (lastUsage.cache_creation_input_tokens ?? 0)
      : 0;

  return {
    subagentType,
    truncatedDesc,
    teamColors,
    typeColors,
    isShutdownOnly,
    toggleSubagentTraceExpansion,
    displayItems,
    itemsSummary,
    modelInfo,
    lastUsage,
    phaseData,
    searchCurrentSubagentItemId,
    shouldExpandForSearch,
    isTraceExpanded,
    outerHighlight,
    cumulativeMetrics,
    hasMainImpact,
    hasIsolated,
    isMultiPhase,
    isolatedTotal,
  };
};
