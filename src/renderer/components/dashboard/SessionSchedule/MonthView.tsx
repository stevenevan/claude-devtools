import React, { useMemo, useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { WEEKDAY_LABELS } from './constants';
import { isSameDay } from './dateUtils';
import { MonthDayCell } from './MonthDayCell';

import type { MonthViewProps } from './types';
import type { ScheduleEvent } from '@renderer/hooks/useAnalyticsData';

export const MonthView = ({ events, monthCount }: Readonly<MonthViewProps>): React.JSX.Element => {
  const defaultMonth = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }, []);

  const [currentMonth, setCurrentMonth] = useState(defaultMonth);

  const navigate = (dir: -1 | 1): void => {
    setCurrentMonth((prev) => {
      const next = new Date(prev);
      next.setMonth(next.getMonth() + dir * monthCount);
      return next;
    });
  };

  const goToToday = (): void => {
    const d = new Date();
    setCurrentMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  };

  // Build month grids
  const monthGrids = useMemo(() => {
    const grids: {
      label: string;
      weeks: { date: Date; isCurrentMonth: boolean; events: ScheduleEvent[] }[][];
    }[] = [];

    for (let m = 0; m < monthCount; m++) {
      const monthStart = new Date(currentMonth);
      monthStart.setMonth(monthStart.getMonth() + m);
      const year = monthStart.getFullYear();
      const month = monthStart.getMonth();

      const label = monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

      // Find Monday before or on the 1st
      const firstDay = new Date(year, month, 1);
      const dayOfWeek = firstDay.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const gridStart = new Date(year, month, 1 + mondayOffset);

      const weeks: { date: Date; isCurrentMonth: boolean; events: ScheduleEvent[] }[][] = [];
      const cursor = new Date(gridStart);

      // Build 6 weeks to always fill the grid
      for (let w = 0; w < 6; w++) {
        const week: { date: Date; isCurrentMonth: boolean; events: ScheduleEvent[] }[] = [];
        for (let d = 0; d < 7; d++) {
          const cellDate = new Date(cursor);
          const dayEvents = events.filter((e) => isSameDay(new Date(e.startTime), cellDate));
          week.push({
            date: cellDate,
            isCurrentMonth: cellDate.getMonth() === month,
            events: dayEvents,
          });
          cursor.setDate(cursor.getDate() + 1);
        }
        // Only include week if any day belongs to current month
        if (week.some((d) => d.isCurrentMonth)) {
          weeks.push(week);
        }
      }

      grids.push({ label, weeks });
    }

    return grids;
  }, [currentMonth, monthCount, events]);

  const headerLabel = useMemo(() => {
    if (monthCount === 1) return monthGrids[0]?.label ?? '';
    const first = monthGrids[0]?.label ?? '';
    const last = monthGrids[monthGrids.length - 1]?.label ?? '';
    return `${first} - ${last}`;
  }, [monthGrids, monthCount]);

  return (
    <div className="border-border flex flex-col overflow-hidden rounded-xs border">
      {/* Header */}
      <div className="border-border bg-surface-raised flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="xs" onClick={() => navigate(-1)}>
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button variant="ghost" size="xs" onClick={goToToday}>
            Today
          </Button>
          <Button variant="ghost" size="xs" onClick={() => navigate(1)}>
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
        <span className="text-text-secondary text-xs font-medium">{headerLabel}</span>
      </div>

      {/* Month grids */}
      <div className={cn('gap-4 p-3', monthCount > 1 ? 'grid grid-cols-3' : '')}>
        {monthGrids.map((grid, gi) => (
          <div key={gi}>
            {monthCount > 1 && (
              <p className="text-text-secondary mb-2 text-center text-[10px] font-medium">
                {grid.label}
              </p>
            )}

            {/* Weekday headers */}
            <div className="border-border mb-px grid grid-cols-7 border-b">
              {WEEKDAY_LABELS.map((wd) => (
                <div
                  key={wd}
                  className="text-text-muted py-1.5 text-center text-[9px] font-medium tracking-wider uppercase"
                >
                  {wd}
                </div>
              ))}
            </div>

            {/* Weeks */}
            {grid.weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7">
                {week.map((day, di) => (
                  <MonthDayCell
                    key={di}
                    date={day.date}
                    isCurrentMonth={day.isCurrentMonth}
                    events={day.events}
                    compact={monthCount > 1}
                  />
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>

      {events.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <p className="text-text-muted text-sm">No session activity in this period</p>
        </div>
      )}
    </div>
  );
};
