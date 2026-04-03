import React from 'react';

import { cn } from '@renderer/lib/utils';
import { getTriggerColorDef, type TriggerColor } from '@shared/constants/triggerColors';
import { ChevronRight } from 'lucide-react';

import { formatDuration, formatTokens, getStatusDotClass } from './baseItemHelpers';

// Types

export type ItemStatus = 'ok' | 'error' | 'pending' | 'orphaned';

interface BaseItemProps {
  /** Icon component to display */
  icon: React.ReactNode;
  /** Primary label (e.g., "Thinking", "Output", tool name) */
  label: string;
  /** Summary text shown after the label */
  summary?: string;
  /** Token count to display */
  tokenCount?: number;
  /** Label for tokens (default: "tokens") */
  tokenLabel?: string;
  /** Status indicator (green/red/gray dot) */
  status?: ItemStatus;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Click handler for toggling */
  onClick: () => void;
  /** Whether the item is expanded */
  isExpanded: boolean;
  /** Whether the item has expandable content */
  hasExpandableContent?: boolean;
  /** Additional classes for highlighting (e.g., error deep linking) */
  highlightClasses?: string;
  /** Inline styles for highlighting (used by custom hex colors) */
  highlightStyle?: React.CSSProperties;
  /** Notification dot color for custom triggers */
  notificationDotColor?: TriggerColor;
  /** Children rendered when expanded */
  children?: React.ReactNode;
}

// Helper Components

/**
 * Small status dot indicator.
 */
export const StatusDot: React.FC<{ status: ItemStatus }> = ({ status }) => {
  return (
    <span
      className={cn('inline-block size-1.5 shrink-0 rounded-full', getStatusDotClass(status))}
    />
  );
};

// Main Component

/**
 * BaseItem provides a consistent layout for all expandable items in the chat view.
 *
 * Layout:
 * - Clickable header row with icon, label, summary, tokens, status, and chevron
 * - Expanded content area with left border indent
 *
 * Used by: ThinkingItem, TextItem, LinkedToolItem, SlashItem, SubagentItem
 */
export const BaseItem: React.FC<BaseItemProps> = ({
  icon,
  label,
  summary,
  tokenCount,
  tokenLabel = 'tokens',
  status,
  durationMs,
  onClick,
  isExpanded,
  hasExpandableContent = true,
  highlightClasses = '',
  highlightStyle,
  notificationDotColor,
  children,
}) => {
  return (
    <div
      className={cn('rounded-sm transition-all duration-300', highlightClasses)}
      style={highlightStyle}
    >
      {/* Clickable Header */}
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
        className="group hover:bg-card/50 flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5"
      >
        {/* Icon */}
        <span className="text-muted-foreground size-4 shrink-0">{icon}</span>

        {/* Label */}
        <span className="text-foreground text-sm font-medium">{label}</span>

        {/* Separator and Summary */}
        {summary && (
          <>
            <span className="text-muted-foreground text-sm">-</span>
            <span className="text-muted-foreground flex-1 truncate text-sm">{summary}</span>
          </>
        )}

        {/* Spacer if no summary */}
        {!summary && <span className="flex-1" />}

        {/* Token count badge */}
        {tokenCount != null && tokenCount > 0 && (
          <span className="bg-muted text-muted-foreground shrink-0 rounded-sm px-1.5 py-0.5 text-xs">
            ~{formatTokens(tokenCount)} {tokenLabel}
          </span>
        )}

        {/* Status indicator - hidden when notification dot replaces it */}
        {status && !notificationDotColor && <StatusDot status={status} />}

        {/* Notification dot (replaces status dot when present) */}
        {notificationDotColor && (
          <span
            className="inline-block size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: getTriggerColorDef(notificationDotColor).hex }}
          />
        )}

        {/* Duration */}
        {durationMs !== undefined && (
          <span className="text-muted-foreground shrink-0 text-xs">
            {formatDuration(durationMs)}
          </span>
        )}

        {/* Expand/collapse chevron */}
        {hasExpandableContent && (
          <ChevronRight
            className={cn(
              'size-3 shrink-0 transition-transform text-muted-foreground',
              isExpanded && 'rotate-90'
            )}
          />
        )}
      </div>

      {/* Expanded Content */}
      {isExpanded && children && (
        <div className="border-border mt-2 ml-2 space-y-3 border-l-2 pl-6">{children}</div>
      )}
    </div>
  );
};
