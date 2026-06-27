import { ReactNode, CSSProperties, FC } from 'react';

import { cn } from '@renderer/lib/utils';
import { getTriggerColorDef, type TriggerColor } from '@shared/constants/triggerColors';
import { ChevronRight } from 'lucide-react';

import { formatDuration, formatTokens, getStatusDotClass } from './baseItemHelpers';

// Types

export type ItemStatus = 'ok' | 'error' | 'pending' | 'orphaned';

interface BaseItemProps {

  icon: ReactNode;

  label: string;

  summary?: string;

  tokenCount?: number;

  tokenLabel?: string;

  status?: ItemStatus;

  durationMs?: number;

  onClick: () => void;

  isExpanded: boolean;

  hasExpandableContent?: boolean;

  highlightClasses?: string;

  highlightStyle?: CSSProperties;

  notificationDotColor?: TriggerColor;

  children?: ReactNode;
}

// Helper Components

export const StatusDot: FC<{ status: ItemStatus }> = ({ status }) => {
  return (
    <span
      className={cn('inline-block size-1.5 shrink-0 rounded-full', getStatusDotClass(status))}
    />
  );
};

// Main Component

export const BaseItem: FC<BaseItemProps> = ({
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
