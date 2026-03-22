import React, { useState } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover';
import { Separator } from '@renderer/components/ui/separator';
import { COLOR_TEXT_MUTED, COLOR_TEXT_SECONDARY } from '@renderer/constants/cssVariables';
import { getModelColorClass } from '@shared/utils/modelParser';
import {
  formatTokensCompact as formatTokens,
  formatTokensDetailed,
} from '@shared/utils/tokenFormatting';
import { ChevronRight, Info } from 'lucide-react';

import type { ClaudeMdStats } from '@renderer/types/claudeMd';
import type { ContextStats } from '@renderer/types/contextInjection';
import type { ModelInfo } from '@shared/utils/modelParser';

interface TokenUsageDisplayProps {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  thinkingTokens?: number;
  textOutputTokens?: number;
  modelName?: string;
  modelFamily?: ModelInfo['family'];
  size?: 'sm' | 'md';
  claudeMdStats?: ClaudeMdStats;
  contextStats?: ContextStats;
  phaseNumber?: number;
  totalPhases?: number;
}

const SessionContextSection = ({
  contextStats,
  totalTokens,
  thinkingTokens = 0,
  textOutputTokens = 0,
}: Readonly<{
  contextStats: ContextStats;
  totalTokens: number;
  thinkingTokens?: number;
  textOutputTokens?: number;
}>): React.JSX.Element => {
  const [expanded, setExpanded] = useState(false);

  const { tokensByCategory } = contextStats;
  const thinkingTextTokens = thinkingTokens + textOutputTokens;
  const adjustedContextTotal = contextStats.totalEstimatedTokens + thinkingTextTokens;
  const contextPercent =
    totalTokens > 0 ? Math.min((adjustedContextTotal / totalTokens) * 100, 100).toFixed(1) : '0.0';

  const claudeMdCount = contextStats.accumulatedInjections.filter(
    (inj) => inj.category === 'claude-md'
  ).length;
  const mentionedFilesCount = contextStats.accumulatedInjections.filter(
    (inj) => inj.category === 'mentioned-file'
  ).length;
  const toolOutputsCount = contextStats.accumulatedInjections.filter(
    (inj) => inj.category === 'tool-output'
  ).length;
  const taskCoordinationCount = contextStats.accumulatedInjections.filter(
    (inj) => inj.category === 'task-coordination'
  ).length;
  const userMessagesCount = contextStats.accumulatedInjections.filter(
    (inj) => inj.category === 'user-message'
  ).length;

  const pct = (n: number) =>
    totalTokens > 0 ? Math.min((n / totalTokens) * 100, 100).toFixed(1) : '0.0';

  return (
    <div className="mt-1">
      <Separator className="my-1" />

      <div
        role="button"
        tabIndex={0}
        className="-mx-1 flex cursor-pointer items-center justify-between gap-3 rounded-sm px-1 py-0.5 transition-colors hover:bg-white/5"
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
      >
        <div className="flex items-center gap-1" style={{ color: COLOR_TEXT_MUTED }}>
          <ChevronRight
            className={`size-3 shrink-0 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
          />
          <span className="text-[10px] whitespace-nowrap">Visible Context</span>
        </div>
        <span
          className="text-[10px] whitespace-nowrap tabular-nums"
          style={{ color: COLOR_TEXT_MUTED }}
        >
          {formatTokens(adjustedContextTotal)} ({contextPercent}%)
        </span>
      </div>

      {expanded && (
        <div className="mt-1 space-y-1.5 pl-4">
          {tokensByCategory.claudeMd > 0 && (
            <div className="flex items-center justify-between text-[10px]">
              <span style={{ color: COLOR_TEXT_MUTED }}>
                CLAUDE.md <span className="opacity-60">×{claudeMdCount}</span>
              </span>
              <span className="tabular-nums" style={{ color: COLOR_TEXT_SECONDARY }}>
                {formatTokens(tokensByCategory.claudeMd)}{' '}
                <span className="opacity-60">({pct(tokensByCategory.claudeMd)}%)</span>
              </span>
            </div>
          )}

          {tokensByCategory.mentionedFiles > 0 && (
            <div className="flex items-center justify-between text-[10px]">
              <span style={{ color: COLOR_TEXT_MUTED }}>
                @files <span className="opacity-60">×{mentionedFilesCount}</span>
              </span>
              <span className="tabular-nums" style={{ color: COLOR_TEXT_SECONDARY }}>
                {formatTokens(tokensByCategory.mentionedFiles)}{' '}
                <span className="opacity-60">({pct(tokensByCategory.mentionedFiles)}%)</span>
              </span>
            </div>
          )}

          {tokensByCategory.toolOutputs > 0 && (
            <div className="flex items-center justify-between text-[10px]">
              <span style={{ color: COLOR_TEXT_MUTED }}>
                Tool Outputs <span className="opacity-60">×{toolOutputsCount}</span>
              </span>
              <span className="tabular-nums" style={{ color: COLOR_TEXT_SECONDARY }}>
                {formatTokens(tokensByCategory.toolOutputs)}{' '}
                <span className="opacity-60">({pct(tokensByCategory.toolOutputs)}%)</span>
              </span>
            </div>
          )}

          {tokensByCategory.taskCoordination > 0 && (
            <div className="flex items-center justify-between text-[10px]">
              <span style={{ color: COLOR_TEXT_MUTED }}>
                Task Coordination <span className="opacity-60">×{taskCoordinationCount}</span>
              </span>
              <span className="tabular-nums" style={{ color: COLOR_TEXT_SECONDARY }}>
                {formatTokens(tokensByCategory.taskCoordination)}{' '}
                <span className="opacity-60">({pct(tokensByCategory.taskCoordination)}%)</span>
              </span>
            </div>
          )}

          {tokensByCategory.userMessages > 0 && (
            <div className="flex items-center justify-between text-[10px]">
              <span style={{ color: COLOR_TEXT_MUTED }}>
                User Messages <span className="opacity-60">×{userMessagesCount}</span>
              </span>
              <span className="tabular-nums" style={{ color: COLOR_TEXT_SECONDARY }}>
                {formatTokens(tokensByCategory.userMessages)}{' '}
                <span className="opacity-60">({pct(tokensByCategory.userMessages)}%)</span>
              </span>
            </div>
          )}

          {thinkingTextTokens > 0 && (
            <div className="flex items-center justify-between text-[10px]">
              <span style={{ color: COLOR_TEXT_MUTED }}>Thinking + Text</span>
              <span className="tabular-nums" style={{ color: COLOR_TEXT_SECONDARY }}>
                {formatTokens(thinkingTextTokens)}{' '}
                <span className="opacity-60">({pct(thinkingTextTokens)}%)</span>
              </span>
            </div>
          )}

          <div
            className="pt-0.5 text-[9px] italic"
            style={{ color: COLOR_TEXT_MUTED, opacity: 0.7 }}
          >
            Accumulated across entire session without duplication
          </div>
        </div>
      )}
    </div>
  );
};

export const TokenUsageDisplay = ({
  inputTokens,
  outputTokens,
  cacheReadTokens,
  cacheCreationTokens,
  thinkingTokens = 0,
  textOutputTokens = 0,
  modelName,
  modelFamily,
  size = 'sm',
  claudeMdStats,
  contextStats,
  phaseNumber,
  totalPhases,
}: Readonly<TokenUsageDisplayProps>): React.JSX.Element => {
  const totalTokens = inputTokens + cacheReadTokens + cacheCreationTokens + outputTokens;
  const formattedTotal = formatTokens(totalTokens);

  const textSize = size === 'sm' ? 'text-xs' : 'text-sm';
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5';
  const modelColorClass = modelFamily ? getModelColorClass(modelFamily) : '';

  return (
    <div
      className={`inline-flex items-center gap-1 ${textSize}`}
      style={{ color: COLOR_TEXT_MUTED }}
    >
      <span className="font-medium">{formattedTotal}</span>
      {totalPhases && totalPhases > 1 && phaseNumber && (
        <span
          className="rounded-sm px-1 py-0.5 text-[10px]"
          style={{ backgroundColor: 'rgba(99, 102, 241, 0.15)', color: '#818cf8' }}
        >
          Phase {phaseNumber}/{totalPhases}
        </span>
      )}
      <Popover>
        <PopoverTrigger
          className="relative"
          aria-label="Token usage details"
        >
          <Info className={`${iconSize} cursor-help transition-colors`} style={{ color: COLOR_TEXT_MUTED }} />
        </PopoverTrigger>
        <PopoverContent className="w-56 p-3" align="start">
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span style={{ color: COLOR_TEXT_MUTED }}>Input Tokens</span>
              <span className="font-medium tabular-nums" style={{ color: COLOR_TEXT_SECONDARY }}>
                {formatTokensDetailed(inputTokens)}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span style={{ color: COLOR_TEXT_MUTED }}>Cache Read</span>
              <span className="font-medium tabular-nums" style={{ color: COLOR_TEXT_SECONDARY }}>
                {formatTokensDetailed(cacheReadTokens)}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span style={{ color: COLOR_TEXT_MUTED }}>Cache Write</span>
              <span className="font-medium tabular-nums" style={{ color: COLOR_TEXT_SECONDARY }}>
                {formatTokensDetailed(cacheCreationTokens)}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span style={{ color: COLOR_TEXT_MUTED }}>Output Tokens</span>
              <span className="font-medium tabular-nums" style={{ color: COLOR_TEXT_SECONDARY }}>
                {formatTokensDetailed(outputTokens)}
              </span>
            </div>

            <Separator className="my-1" />

            <div className="flex items-center justify-between">
              <span className="font-medium" style={{ color: COLOR_TEXT_SECONDARY }}>Total</span>
              <span
                className="font-medium tabular-nums"
                style={{ color: 'var(--color-text-primary, var(--color-text))' }}
              >
                {formatTokensDetailed(totalTokens)}
              </span>
            </div>

            {contextStats &&
              (contextStats.totalEstimatedTokens > 0 ||
                thinkingTokens > 0 ||
                textOutputTokens > 0) && (
                <SessionContextSection
                  contextStats={contextStats}
                  totalTokens={totalTokens}
                  thinkingTokens={thinkingTokens}
                  textOutputTokens={textOutputTokens}
                />
              )}

            {!contextStats && claudeMdStats && (
              <div
                className="mt-1 flex items-center justify-between text-[10px]"
                style={{ color: COLOR_TEXT_MUTED }}
              >
                <span className="whitespace-nowrap italic">
                  incl. CLAUDE.md ×{claudeMdStats.accumulatedCount}
                </span>
                <span className="tabular-nums">
                  {totalTokens > 0
                    ? ((claudeMdStats.totalEstimatedTokens / totalTokens) * 100).toFixed(1)
                    : '0.0'}
                  %
                </span>
              </div>
            )}

            {modelName && (
              <>
                <Separator className="my-1" />
                <div className="flex items-center justify-between">
                  <span style={{ color: COLOR_TEXT_MUTED }}>Model</span>
                  <span
                    className={`font-medium ${modelColorClass}`}
                    style={!modelColorClass ? { color: COLOR_TEXT_SECONDARY } : {}}
                  >
                    {modelName}
                  </span>
                </div>
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};
