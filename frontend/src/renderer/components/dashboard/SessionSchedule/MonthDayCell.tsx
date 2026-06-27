
import { JSX } from 'react';
import { cn } from '@renderer/lib/utils';

import { MAX_EVENTS_PER_DAY } from './constants';
import { isTodayDate } from './dateUtils';

import type { MonthDayCellProps } from './types';

export const MonthDayCell = ({
  date,
  isCurrentMonth,
  events,
  compact,
}: Readonly<MonthDayCellProps>): JSX.Element => {
  const isToday = isTodayDate(date);
  const visibleEvents = events.slice(0, MAX_EVENTS_PER_DAY);
  const overflow = events.length - MAX_EVENTS_PER_DAY;

  return (
    <div
      className={cn(
        'border-border/30 min-h-[60px] border-b border-r p-1 last:border-r-0',
        !isCurrentMonth && 'opacity-30',
        isToday && 'bg-indigo-500/5'
      )}
    >
      <div className="mb-0.5 flex items-center justify-end">
        <span
          className={cn(
            'text-[10px]',
            isToday
              ? 'flex size-5 items-center justify-center rounded-full bg-indigo-500 font-bold text-white'
              : 'text-text-muted font-medium'
          )}
        >
          {date.getDate()}
        </span>
      </div>
      <div className="space-y-0.5">
        {visibleEvents.map((evt) => (
          <div
            key={evt.id}
            className="truncate rounded-xs px-1 py-px text-[8px] leading-tight"
            style={{ backgroundColor: evt.color + '20', color: evt.color }}
            title={`${evt.projectName}: ${evt.sessionTitle}\n${new Date(evt.startTime).toLocaleTimeString()}`}
          >
            {compact ? evt.projectName.slice(0, 8) : evt.projectName}
          </div>
        ))}
        {overflow > 0 && <div className="text-text-muted px-1 text-[8px]">+{overflow} more</div>}
      </div>
    </div>
  );
};
