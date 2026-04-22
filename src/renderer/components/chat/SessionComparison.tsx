/**
 * SessionComparison - Side-by-side comparison of two sessions.
 * Shows metrics, tool usage, and conversation differences.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@renderer/api';
import { cn } from '@renderer/lib/utils';
import { formatDuration, formatTokensCompact } from '@renderer/utils/formatters';
import { parseModelString } from '@shared/utils/modelParser';
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronUp,
  Clock,
  DollarSign,
  Hash,
  Layers,
  Loader2,
  MessageSquare,
  Wrench,
  Zap,
} from 'lucide-react';

import { Button } from '../ui/button';

import type { Chunk, SessionDetail } from '@shared/types/chunks';
import type { Tab } from '@renderer/types/tabs';

interface SessionComparisonProps {
  tab: Tab;
}

interface MetricRowProps {
  icon: React.ElementType;
  label: string;
  leftValue: string;
  rightValue: string;
  iconColor?: string;
}

function formatCost(cost?: number): string {
  if (!cost) return '--';
  if (cost < 0.01) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

const MetricRow = ({ icon: Icon, label, leftValue, rightValue, iconColor = 'text-muted-foreground' }: Readonly<MetricRowProps>): React.JSX.Element => (
  <div className="flex items-center gap-3 py-1.5">
    <Icon className={cn('size-3.5 shrink-0', iconColor)} />
    <span className="text-muted-foreground w-24 shrink-0 text-xs">{label}</span>
    <span className="text-foreground flex-1 text-right text-xs tabular-nums">{leftValue}</span>
    <span className="text-foreground flex-1 text-right text-xs tabular-nums">{rightValue}</span>
  </div>
);

/** Count tool calls by name from session detail chunks. */
function countTools(detail: SessionDetail): Map<string, number> {
  const counts = new Map<string, number>();
  for (const chunk of detail.chunks) {
    if ('toolExecutions' in chunk) {
      for (const exec of (chunk as { toolExecutions: { toolCall: { name: string } }[] }).toolExecutions) {
        const name = exec.toolCall.name;
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
  }
  return counts;
}

export const SessionComparison = ({ tab }: Readonly<SessionComparisonProps>): React.JSX.Element => {
  const [leftDetail, setLeftDetail] = useState<SessionDetail | null>(null);
  const [rightDetail, setRightDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tab.projectId || !tab.sessionId || !tab.compareProjectId || !tab.compareSessionId) return;

    setLoading(true);
    void Promise.all([
      api.getSessionDetail(tab.projectId, tab.sessionId),
      api.getSessionDetail(tab.compareProjectId, tab.compareSessionId),
    ]).then(([left, right]) => {
      setLeftDetail(left);
      setRightDetail(right);
      setLoading(false);
    });
  }, [tab.projectId, tab.sessionId, tab.compareProjectId, tab.compareSessionId]);

  if (loading) {
    return (
      <div className="bg-background flex flex-1 items-center justify-center">
        <Loader2 className="text-muted-foreground size-6 animate-spin" />
      </div>
    );
  }

  if (!leftDetail || !rightDetail) {
    return (
      <div className="bg-background flex flex-1 items-center justify-center">
        <p className="text-muted-foreground text-sm">Failed to load session data for comparison</p>
      </div>
    );
  }

  const leftMetrics = leftDetail.metrics;
  const rightMetrics = rightDetail.metrics;
  const leftModel = leftMetrics.model ? parseModelString(leftMetrics.model)?.name ?? leftMetrics.model : '--';
  const rightModel = rightMetrics.model ? parseModelString(rightMetrics.model)?.name ?? rightMetrics.model : '--';

  const leftTools = countTools(leftDetail);
  const rightTools = countTools(rightDetail);
  const allToolNames = new Set([...leftTools.keys(), ...rightTools.keys()]);

  return (
    <div className="bg-background flex-1 overflow-auto">
      <div className="mx-auto max-w-3xl px-8 py-12">
        {/* Header */}
        <div className="mb-8 flex items-center gap-3">
          <ArrowLeftRight className="text-indigo-400" />
          <h1 className="text-foreground text-lg font-semibold">Session Comparison</h1>
        </div>

        {/* Session labels */}
        <div className="mb-4 flex items-center gap-3">
          <div className="w-24 shrink-0" />
          <div className="flex-1 text-right">
            <span className="text-foreground truncate text-xs font-medium">
              {leftDetail.session.customTitle ?? tab.sessionId?.slice(0, 8) ?? 'Session A'}
            </span>
          </div>
          <div className="flex-1 text-right">
            <span className="text-foreground truncate text-xs font-medium">
              {rightDetail.session.customTitle ?? tab.compareSessionId?.slice(0, 8) ?? 'Session B'}
            </span>
          </div>
        </div>

        {/* Metrics comparison */}
        <div className="border-border rounded-lg border p-4">
          <h2 className="text-muted-foreground mb-3 text-[10px] font-medium uppercase tracking-wider">
            Metrics
          </h2>
          <div className="divide-border divide-y">
            <MetricRow icon={Zap} label="Total Tokens" leftValue={formatTokensCompact(leftMetrics.totalTokens)} rightValue={formatTokensCompact(rightMetrics.totalTokens)} iconColor="text-amber-400/70" />
            <MetricRow icon={DollarSign} label="Cost" leftValue={formatCost(leftMetrics.costUsd)} rightValue={formatCost(rightMetrics.costUsd)} iconColor="text-green-400/70" />
            <MetricRow icon={Clock} label="Duration" leftValue={formatDuration(leftMetrics.durationMs)} rightValue={formatDuration(rightMetrics.durationMs)} iconColor="text-blue-400/70" />
            <MetricRow icon={Hash} label="Messages" leftValue={String(leftMetrics.messageCount)} rightValue={String(rightMetrics.messageCount)} iconColor="text-purple-400/70" />
            <MetricRow icon={Layers} label="Model" leftValue={leftModel} rightValue={rightModel} iconColor="text-indigo-400/70" />
          </div>
        </div>

        {/* Tool usage comparison */}
        {allToolNames.size > 0 && (
          <div className="border-border mt-6 rounded-lg border p-4">
            <h2 className="text-muted-foreground mb-3 text-[10px] font-medium uppercase tracking-wider">
              Tool Usage
            </h2>
            <div className="divide-border divide-y">
              {[...allToolNames].sort().map((toolName) => (
                <div key={toolName} className="flex items-center gap-3 py-1.5">
                  <Wrench className="text-muted-foreground size-3.5 shrink-0" />
                  <span className="text-muted-foreground w-24 shrink-0 truncate font-mono text-xs">{toolName}</span>
                  <span className="text-foreground flex-1 text-right text-xs tabular-nums">
                    {leftTools.get(toolName) ?? 0}
                  </span>
                  <span className="text-foreground flex-1 text-right text-xs tabular-nums">
                    {rightTools.get(toolName) ?? 0}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* Conversation Diff */}
        <ConversationDiff leftDetail={leftDetail} rightDetail={rightDetail} />
      </div>
    </div>
  );
};

// Conversation Diff Types

interface TurnSummary {
  index: number;
  userText: string;
  aiSummary: string;
  toolCount: number;
}

/** Extract turn summaries (user message + AI response summary) from chunks. */
function extractTurns(detail: SessionDetail): TurnSummary[] {
  const turns: TurnSummary[] = [];
  const chunks = detail.chunks;
  let turnIndex = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk.chunkType !== 'user') continue;

    const userText =
      typeof chunk.userMessage.content === 'string'
        ? chunk.userMessage.content.slice(0, 200)
        : '[complex content]';

    // Find the following AI chunk
    const nextChunk: Chunk | undefined = chunks[i + 1];
    let aiSummary = '';
    let toolCount = 0;

    if (nextChunk?.chunkType === 'ai') {
      toolCount = nextChunk.toolExecutions.length;
      // Get last text output from responses
      for (let j = nextChunk.responses.length - 1; j >= 0; j--) {
        const resp = nextChunk.responses[j];
        if (resp.type === 'assistant' && Array.isArray(resp.content)) {
          const textBlock = resp.content.find(
            (b: { type: string }) => b.type === 'text'
          ) as { text?: string } | undefined;
          if (textBlock?.text) {
            aiSummary = textBlock.text.slice(0, 200);
            break;
          }
        }
      }
    }

    turns.push({ index: turnIndex++, userText, aiSummary, toolCount });
  }

  return turns;
}

/** Check if two strings are meaningfully different. */
function isDivergent(a: string, b: string): boolean {
  if (a === b) return false;
  // Normalize whitespace for comparison
  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
  return norm(a) !== norm(b);
}

interface ConversationDiffProps {
  leftDetail: SessionDetail;
  rightDetail: SessionDetail;
}

const ConversationDiff = ({
  leftDetail,
  rightDetail,
}: Readonly<ConversationDiffProps>): React.JSX.Element | null => {
  const leftTurns = useMemo(() => extractTurns(leftDetail), [leftDetail]);
  const rightTurns = useMemo(() => extractTurns(rightDetail), [rightDetail]);

  const maxTurns = Math.max(leftTurns.length, rightTurns.length);

  // Find divergent turn indices
  const divergentIndices = useMemo(() => {
    const indices: number[] = [];
    for (let i = 0; i < maxTurns; i++) {
      const left = leftTurns[i];
      const right = rightTurns[i];
      if (!left || !right || isDivergent(left.userText, right.userText)) {
        indices.push(i);
      }
    }
    return indices;
  }, [leftTurns, rightTurns, maxTurns]);

  const [currentDivergenceIdx, setCurrentDivergenceIdx] = useState(0);
  const turnRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const scrollToDivergence = useCallback(
    (idx: number) => {
      const turnIndex = divergentIndices[idx];
      if (turnIndex == null) return;
      const el = turnRefs.current.get(turnIndex);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setCurrentDivergenceIdx(idx);
    },
    [divergentIndices]
  );

  if (maxTurns === 0) return null;

  return (
    <div className="border-border mt-6 rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">
          Conversation ({maxTurns} turns)
        </h2>
        {divergentIndices.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground text-[10px]">
              {divergentIndices.length} divergence{divergentIndices.length !== 1 && 's'}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() =>
                scrollToDivergence(
                  (currentDivergenceIdx - 1 + divergentIndices.length) % divergentIndices.length
                )
              }
              title="Previous divergence"
            >
              <ChevronUp className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() =>
                scrollToDivergence((currentDivergenceIdx + 1) % divergentIndices.length)
              }
              title="Next divergence"
            >
              <ChevronDown className="size-3" />
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {Array.from({ length: maxTurns }).map((_, i) => {
          const left = leftTurns[i];
          const right = rightTurns[i];
          const hasDivergence =
            !left || !right || isDivergent(left?.userText ?? '', right?.userText ?? '');

          return (
            <div
              key={i}
              ref={(el) => {
                if (el) turnRefs.current.set(i, el);
              }}
              className={cn(
                'flex gap-3 rounded-sm border px-3 py-2',
                hasDivergence
                  ? 'border-amber-500/30 bg-amber-500/5'
                  : 'border-border'
              )}
            >
              {/* Turn number */}
              <div className="text-muted-foreground flex shrink-0 items-start pt-0.5 text-[10px] tabular-nums">
                <MessageSquare className="mr-1 size-3" />
                {i + 1}
              </div>

              {/* Left session */}
              <div className="min-w-0 flex-1">
                {left ? (
                  <>
                    <div className="text-foreground mb-0.5 text-[11px] leading-snug">
                      {left.userText}
                    </div>
                    <div className="text-muted-foreground text-[10px]">
                      {left.toolCount > 0 && `${left.toolCount} tools · `}
                      {left.aiSummary
                        ? left.aiSummary.slice(0, 80) + (left.aiSummary.length > 80 ? '...' : '')
                        : 'No response'}
                    </div>
                  </>
                ) : (
                  <span className="text-muted-foreground/50 text-[10px] italic">—</span>
                )}
              </div>

              {/* Divider */}
              <div className="border-border w-px self-stretch border-l" />

              {/* Right session */}
              <div className="min-w-0 flex-1">
                {right ? (
                  <>
                    <div className="text-foreground mb-0.5 text-[11px] leading-snug">
                      {right.userText}
                    </div>
                    <div className="text-muted-foreground text-[10px]">
                      {right.toolCount > 0 && `${right.toolCount} tools · `}
                      {right.aiSummary
                        ? right.aiSummary.slice(0, 80) + (right.aiSummary.length > 80 ? '...' : '')
                        : 'No response'}
                    </div>
                  </>
                ) : (
                  <span className="text-muted-foreground/50 text-[10px] italic">—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
