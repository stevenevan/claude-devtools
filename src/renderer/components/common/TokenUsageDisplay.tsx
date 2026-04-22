import React, { useState } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover';
import { Separator } from '@renderer/components/ui/separator';
import { cn } from '@renderer/lib/utils';
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

  const pct = (n: number): string =>
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
        <div className="text-muted-foreground flex items-center gap-1">
          <ChevronRight
            className={cn(
              'size-3 shrink-0 transition-transform duration-150',
              expanded && 'rotate-90'
            )}
          />
          <span className="text-[10px] whitespace-nowrap">Visible Context</span>
        </div>
        <span className="text-muted-foreground text-[10px] whitespace-nowrap tabular-nums">
          {formatTokens(adjustedContextTotal)} ({contextPercent}%)
        </span>
      </div>

      {expanded && (
        <div className="mt-1 space-y-1.5 pl-4">
          {tokensByCategory.claudeMd > 0 && (
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">
                CLAUDE.md <span className="opacity-60">×{claudeMdCount}</span>
              </span>
              <span className="text-muted-foreground tabular-nums">
                {formatTokens(tokensByCategory.claudeMd)}{' '}
                <span className="opacity-60">({pct(tokensByCategory.claudeMd)}%)</span>
              </span>
            </div>
          )}

          {tokensByCategory.mentionedFiles > 0 && (
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">
                @files <span className="opacity-60">×{mentionedFilesCount}</span>
              </span>
              <span className="text-muted-foreground tabular-nums">
                {formatTokens(tokensByCategory.mentionedFiles)}{' '}
                <span className="opacity-60">({pct(tokensByCategory.mentionedFiles)}%)</span>
              </span>
            </div>
          )}

          {tokensByCategory.toolOutputs > 0 && (
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">
                Tool Outputs <span className="opacity-60">×{toolOutputsCount}</span>
              </span>
              <span className="text-muted-foreground tabular-nums">
                {formatTokens(tokensByCategory.toolOutputs)}{' '}
                <span className="opacity-60">({pct(tokensByCategory.toolOutputs)}%)</span>
              </span>
            </div>
          )}

          {tokensByCategory.taskCoordination > 0 && (
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">
                Task Coordination <span className="opacity-60">×{taskCoordinationCount}</span>
              </span>
              <span className="text-muted-foreground tabular-nums">
                {formatTokens(tokensByCategory.taskCoordination)}{' '}
                <span className="opacity-60">({pct(tokensByCategory.taskCoordination)}%)</span>
              </span>
            </div>
          )}

          {tokensByCategory.userMessages > 0 && (
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">
                User Messages <span className="opacity-60">×{userMessagesCount}</span>
              </span>
              <span className="text-muted-foreground tabular-nums">
                {formatTokens(tokensByCategory.userMessages)}{' '}
                <span className="opacity-60">({pct(tokensByCategory.userMessages)}%)</span>
              </span>
            </div>
          )}

          {thinkingTextTokens > 0 && (
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">Thinking + Text</span>
              <span className="text-muted-foreground tabular-nums">
                {formatTokens(thinkingTextTokens)}{' '}
                <span className="opacity-60">({pct(thinkingTextTokens)}%)</span>
              </span>
            </div>
          )}

          <div className="text-muted-foreground pt-0.5 text-[9px] italic opacity-70">
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
    <div className={cn(`text-muted-foreground inline-flex items-center gap-1`, textSize)}>
      <span className="font-medium">{formattedTotal}</span>
      {totalPhases && totalPhases > 1 && phaseNumber && (
        <span className="rounded-sm bg-indigo-500/10 px-1 py-0.5 text-[10px] text-indigo-400">
          Phase {phaseNumber}/{totalPhases}
        </span>
      )}
      <Popover>
        <PopoverTrigger className="relative" aria-label="Token usage details">
          <Info className={cn(iconSize, 'cursor-help text-muted-foreground transition-colors')} />
        </PopoverTrigger>
        <PopoverContent className="w-56 p-3" align="start">
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Input Tokens</span>
              <span className="text-muted-foreground font-medium tabular-nums">
                {formatTokensDetailed(inputTokens)}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Cache Read</span>
              <span className="text-muted-foreground font-medium tabular-nums">
                {formatTokensDetailed(cacheReadTokens)}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Cache Write</span>
              <span className="text-muted-foreground font-medium tabular-nums">
                {formatTokensDetailed(cacheCreationTokens)}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Output Tokens</span>
              <span className="text-muted-foreground font-medium tabular-nums">
                {formatTokensDetailed(outputTokens)}
              </span>
            </div>

            <Separator className="my-1" />

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground font-medium">Total</span>
              <span className="text-foreground font-medium tabular-nums">
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
              <div className="text-muted-foreground mt-1 flex items-center justify-between text-[10px]">
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
                  <span className="text-muted-foreground">Model</span>
                  <span className={cn('font-medium', modelColorClass || 'text-muted-foreground')}>
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
