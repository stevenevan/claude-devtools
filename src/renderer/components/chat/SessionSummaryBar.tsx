/**
 * SessionSummaryBar - Compact bar showing session-level metrics at a glance.
 * Sits between SearchBar and ChatHistory in the MiddlePanel.
 */

import { useStore } from '@renderer/store';
import { formatDuration, formatTokensCompact } from '@renderer/utils/formatters';
import { parseModelString } from '@shared/utils/modelParser';
import { Clock, DollarSign, Hash, Layers, Zap } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

interface SessionSummaryBarProps {
  tabId?: string;
}

/** Format cost to a readable string. */
function formatCost(cost: number | undefined): string {
  if (cost === undefined || cost === null) return '--';
  if (cost < 0.001) return '<$0.001';
  if (cost < 0.01) return `$${cost.toFixed(3)}`;
  if (cost < 1) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(2)}`;
}

/** Get a short display name for the model. */
function shortModelName(model: string | undefined): string {
  if (!model) return '';
  const info = parseModelString(model);
  if (!info) return '';
  return info.name;
}

export const SessionSummaryBar = ({ tabId }: Readonly<SessionSummaryBarProps>): React.JSX.Element | null => {
  const { metrics, totalAIGroups, isOngoing } = useStore(
    useShallow((s) => {
      const td = tabId ? s.tabSessionData[tabId] : null;
      const detail = td?.sessionDetail ?? s.sessionDetail;
      const conv = td?.conversation ?? s.conversation;
      return {
        metrics: detail?.metrics ?? null,
        totalAIGroups: conv?.totalAIGroups ?? 0,
        isOngoing: detail?.session?.isOngoing ?? false,
      };
    })
  );

  if (!metrics) return null;

  const model = shortModelName(metrics.model);

  return (
    <div className="border-border/50 bg-surface flex shrink-0 items-center gap-4 border-b px-4 py-1.5 text-xs tabular-nums">
      {/* Tokens */}
      <span className="text-text-secondary flex items-center gap-1.5" title="Total tokens">
        <Zap className="size-3 text-amber-400/70" />
        <span>{formatTokensCompact(metrics.totalTokens)}</span>
      </span>

      {/* Cost */}
      {metrics.costUsd !== undefined && metrics.costUsd > 0 && (
        <span className="text-text-secondary flex items-center gap-1.5" title="Estimated cost">
          <DollarSign className="size-3 text-green-400/70" />
          <span>{formatCost(metrics.costUsd)}</span>
        </span>
      )}

      {/* Duration */}
      <span className="text-text-secondary flex items-center gap-1.5" title="Session duration">
        <Clock className="size-3 text-blue-400/70" />
        <span>{formatDuration(metrics.durationMs)}</span>
      </span>

      {/* Turns */}
      <span className="text-text-secondary flex items-center gap-1.5" title="AI turns">
        <Hash className="size-3 text-purple-400/70" />
        <span>{totalAIGroups} turn{totalAIGroups !== 1 ? 's' : ''}</span>
      </span>

      {/* Model */}
      {model && (
        <span className="text-text-secondary flex items-center gap-1.5" title={metrics.model}>
          <Layers className="size-3 text-indigo-400/70" />
          <span>{model}</span>
        </span>
      )}

      {/* Ongoing dot */}
      {isOngoing && (
        <span className="ml-auto flex items-center gap-1.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
          </span>
          <span className="text-green-400/70 text-[10px] uppercase tracking-wider">Live</span>
        </span>
      )}
    </div>
  );
};
