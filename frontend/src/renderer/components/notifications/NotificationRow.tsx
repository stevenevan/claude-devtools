import { JSX, MouseEvent } from 'react';
import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import { getTriggerColorDef } from '@shared/constants/triggerColors';
import { formatDistanceToNow } from 'date-fns';
import { ArrowRight, Bot, Check, Trash2 } from 'lucide-react';

import type { DetectedError } from '@renderer/types/data';

interface NotificationRowProps {
  error: DetectedError;
  onRowClick: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

function truncateMessage(message: string, maxLength: number = 100): string {
  if (message.length <= maxLength) return message;
  return message.slice(0, maxLength).trim() + '...';
}

export const NotificationRow = ({
  error,
  onRowClick,
  onArchive,
  onDelete,
}: Readonly<NotificationRowProps>): JSX.Element => {
  const isUnread = !error.isRead;
  const projectName = error.context?.projectName || 'Unknown Project';
  const relativeTime = formatDistanceToNow(new Date(error.timestamp), {
    addSuffix: true,
  });
  const truncatedMessage = truncateMessage(error.message);
  const colorDef = getTriggerColorDef(error.triggerColor);
  const displayName = error.triggerName ?? error.source;

  const handleArchiveClick = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    onArchive();
  };

  const handleDeleteClick = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    onDelete();
  };

  const handleNavigateClick = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    onRowClick();
  };

  return (
    <div
      role="group"
      aria-label={`${displayName}, ${projectName}, ${truncatedMessage}`}
      className={cn(
        'group relative flex h-full border-b border-border transition-colors',
        !isUnread && 'opacity-50'
      )}
    >
      <Button
        type="button"
        variant="ghost"
        onClick={onRowClick}
        aria-label={`${displayName}, ${projectName}, ${truncatedMessage}, ${relativeTime}`}
        className="h-full min-w-0 flex-1 justify-start gap-3 rounded-none px-4 text-left hover:bg-card"
      >
        <div className="flex w-3 shrink-0 justify-center">
          <span
            aria-hidden="true"
            className={cn('size-2.5 rounded-full', !isUnread && 'opacity-40')}
            style={{ backgroundColor: colorDef.hex }}
          />
        </div>

        <div className="min-w-0 flex-1 py-2">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                'truncate text-sm font-medium',
                isUnread ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {displayName}
            </span>
            <span aria-hidden="true" className="text-muted-foreground">
              &middot;
            </span>
            <span className="text-muted-foreground truncate text-sm">{projectName}</span>
            {error.subagentId && (
              <span className="text-muted-foreground border-border bg-card inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium">
                <Bot aria-hidden="true" className="size-3" />
                subagent
              </span>
            )}
          </div>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">{truncatedMessage}</p>
        </div>

        <span className="text-muted-foreground shrink-0 text-[11px] whitespace-nowrap transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
          {relativeTime}
        </span>
      </Button>

      <div className="absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
        <HoverActions
          isUnread={isUnread}
          onArchiveClick={handleArchiveClick}
          onDeleteClick={handleDeleteClick}
          onNavigateClick={handleNavigateClick}
        />
      </div>
    </div>
  );
};

interface HoverActionsProps {
  isUnread: boolean;
  onArchiveClick: (event: MouseEvent<HTMLButtonElement>) => void;
  onDeleteClick: (event: MouseEvent<HTMLButtonElement>) => void;
  onNavigateClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

const HoverActions = ({
  isUnread,
  onArchiveClick,
  onDeleteClick,
  onNavigateClick,
}: HoverActionsProps): JSX.Element => {
  return (
    <>
      {isUnread && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onArchiveClick}
          aria-label="Mark as read"
          title="Mark as read"
        >
          <Check aria-hidden="true" />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onDeleteClick}
        aria-label="Delete notification"
        title="Delete notification"
        className="hover:text-red-400"
      >
        <Trash2 aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onNavigateClick}
        aria-label="View in session"
        title="View in session"
      >
        <ArrowRight aria-hidden="true" />
      </Button>
    </>
  );
};
