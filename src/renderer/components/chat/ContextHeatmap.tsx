import { useMemo, useState } from 'react';

import { cn } from '@renderer/lib/utils';
import { formatTokensCompact } from '@shared/utils/tokenFormatting';

import { buildTurnBreakdown } from '@renderer/utils/contextTracker';

import type {
  ContextCategoryKey,
  ContextTurnBreakdown,
} from '@renderer/utils/contextTracker';
import type { ContextStats } from '@renderer/types/contextInjection';
import type { ChatItem } from '@renderer/types/groups';

const CATEGORY_LABEL: Record<ContextCategoryKey, string> = {
  claudeMd: 'CLAUDE.md',
  mentionedFiles: 'Mentioned files',
  toolOutputs: 'Tool outputs',
  thinkingText: 'Thinking & text',
  taskCoordination: 'Task coordination',
  userMessages: 'User messages',
};

/** Category → base hue class. Fill strength scales with turn's share of session max. */
const CATEGORY_HUE: Record<ContextCategoryKey, string> = {
  claudeMd: 'bg-sky-500',
  mentionedFiles: 'bg-emerald-500',
  toolOutputs: 'bg-amber-500',
  thinkingText: 'bg-violet-500',
  taskCoordination: 'bg-rose-500',
  userMessages: 'bg-slate-400',
};

interface ContextHeatmapProps {
  items: ChatItem[];
  statsMap: Map<string, ContextStats>;
  /** Optional handler called when user clicks a segment. */
  onSelectTurn?: (aiGroupId: string, turnIndex: number) => void;
  className?: string;
}

export const ContextHeatmap = ({
  items,
  statsMap,
  onSelectTurn,
  className,
}: Readonly<ContextHeatmapProps>): React.JSX.Element | null => {
  const breakdowns = useMemo(() => buildBreakdowns(items, statsMap), [items, statsMap]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (breakdowns.length === 0) {
    return null;
  }

  const maxTokens = breakdowns.reduce((m, b) => Math.max(m, b.totalTokens), 0);
  const hovered = breakdowns.find((b) => b.aiGroupId === hoveredId);

  return (
    <div
      className={cn(
        'border-border bg-background/50 relative flex flex-col gap-1 rounded-xs border px-2 py-1.5',
        className
      )}
      aria-label="Context window heatmap"
    >
      <div className="flex h-6 items-stretch gap-px">
        {breakdowns.map((b) => {
          const intensity = maxTokens > 0 ? b.totalTokens / maxTokens : 0;
          const hue = b.dominantCategory ? CATEGORY_HUE[b.dominantCategory] : 'bg-muted';
          return (
            <button
              key={b.aiGroupId}
              type="button"
              onMouseEnter={() => setHoveredId(b.aiGroupId)}
              onMouseLeave={() => setHoveredId((prev) => (prev === b.aiGroupId ? null : prev))}
              onFocus={() => setHoveredId(b.aiGroupId)}
              onBlur={() => setHoveredId((prev) => (prev === b.aiGroupId ? null : prev))}
              onClick={() => onSelectTurn?.(b.aiGroupId, b.turnIndex)}
              className={cn(
                'min-w-[4px] flex-1 cursor-pointer rounded-[1px] transition-opacity hover:ring-1 hover:ring-white/30',
                hue
              )}
              style={{ opacity: 0.25 + 0.75 * intensity }}
              title={`Turn ${b.turnIndex + 1} · ${formatTokensCompact(b.totalTokens)}`}
              aria-label={`Turn ${b.turnIndex + 1}, ${formatTokensCompact(b.totalTokens)} tokens`}
            />
          );
        })}
      </div>

      {hovered ? (
        <div className="text-text-muted flex items-center justify-between text-[10px]">
          <span>
            Turn <span className="text-text tabular-nums">{hovered.turnIndex + 1}</span> ·{' '}
            <span className="text-text tabular-nums">
              {formatTokensCompact(hovered.totalTokens)}
            </span>{' '}
            tokens
          </span>
          <span className="flex items-center gap-2">
            {hovered.entries.slice(0, 3).map((entry) => (
              <span key={entry.category} className="inline-flex items-center gap-1">
                <span className={cn('size-2 rounded-[1px]', CATEGORY_HUE[entry.category])} />
                <span>
                  {CATEGORY_LABEL[entry.category]}
                  <span className="text-text-muted ml-1 tabular-nums">
                    {entry.sharePct.toFixed(0)}%
                  </span>
                </span>
              </span>
            ))}
          </span>
        </div>
      ) : (
        <div className="text-text-muted text-[10px]">
          Hover a segment for category breakdown · click to scroll to turn
        </div>
      )}
    </div>
  );
};

function buildBreakdowns(
  items: ChatItem[],
  statsMap: Map<string, ContextStats>
): ContextTurnBreakdown[] {
  const breakdowns: ContextTurnBreakdown[] = [];
  for (const item of items) {
    if (item.type !== 'ai') continue;
    const stats = statsMap.get(item.group.id);
    if (!stats) continue;
    if (stats.totalEstimatedTokens === 0) continue;
    breakdowns.push(
      buildTurnBreakdown(item.group.id, item.group.turnIndex, stats.tokensByCategory)
    );
  }
  return breakdowns;
}
