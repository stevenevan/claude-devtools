/**
 * SessionSchedule - Adaptive timeline that switches between DayView and MonthView.
 * - today/week: DayView with hourly rows and side-by-side overlap resolution
 * - month/3months: MonthView calendar grid with event badges and "+N more" overflow
 */

import React, { useMemo, useRef, useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import type { ScheduleEvent } from '@renderer/hooks/useAnalyticsData';

// =============================================================================
// Props
// =============================================================================

interface SessionScheduleProps {
  events: ScheduleEvent[];
  days: number;
}

// =============================================================================
// Shared Helpers
// =============================================================================

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isTodayDate(date: Date): boolean {
  return isSameDay(date, new Date());
}

function formatHourLabel(h: number): string {
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

// =============================================================================
// Positioned Event (DayView)
// =============================================================================

interface PositionedEvent {
  event: ScheduleEvent;
  top: number;
  height: number;
  left: number;
  width: number;
  column: number;
}

function resolveOverlaps(events: PositionedEvent[]): PositionedEvent[] {
  if (events.length <= 1) return events;
  const sorted = [...events].sort((a, b) => a.top - b.top);
  const columns: PositionedEvent[][] = [];

  for (const evt of sorted) {
    let placed = false;
    for (let col = 0; col < columns.length; col++) {
      const lastInCol = columns[col][columns[col].length - 1];
      if (lastInCol.top + lastInCol.height <= evt.top) {
        evt.column = col;
        columns[col].push(evt);
        placed = true;
        break;
      }
    }
    if (!placed) {
      evt.column = columns.length;
      columns.push([evt]);
    }
  }

  const totalCols = columns.length;
  for (const col of columns) {
    for (const evt of col) {
      evt.width = 100 / totalCols;
      evt.left = evt.column * (100 / totalCols);
    }
  }
  return sorted;
}

// =============================================================================
// DayView Event Block
// =============================================================================

const DayEventBlock = ({
  pe,
  style,
}: {
  pe: PositionedEvent;
  style: React.CSSProperties;
}): React.JSX.Element => {
  const [hovered, setHovered] = useState(false);
  const title = pe.event.sessionTitle;

  return (
    <div
      className="absolute z-10 cursor-default overflow-hidden rounded-xs border px-1.5 py-0.5 text-[10px] leading-tight transition-opacity"
      style={{
        ...style,
        backgroundColor: pe.event.color + '20',
        borderColor: pe.event.color + '40',
        color: pe.event.color,
        opacity: hovered ? 1 : 0.85,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={`${pe.event.projectName}: ${title}\n${new Date(pe.event.startTime).toLocaleTimeString()} - ${new Date(pe.event.endTime).toLocaleTimeString()}`}
    >
      <span className="font-medium">{pe.event.projectName}</span>
      {pe.height > 3 && (
        <p className="mt-0.5 truncate opacity-70">
          {title.length > 40 ? title.slice(0, 40) + '...' : title}
        </p>
      )}
    </div>
  );
};

// =============================================================================
// DayView Component
// =============================================================================

interface DayViewProps {
  events: ScheduleEvent[];
  isSingleDay: boolean;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const SLOT_HEIGHT = 40; // px per hour

const DayView = ({ events, isSingleDay }: Readonly<DayViewProps>): React.JSX.Element => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const defaultDate = useMemo(() => {
    const d = new Date();
    if (!isSingleDay) d.setDate(d.getDate() - 6);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [isSingleDay]);

  const [startDate, setStartDate] = useState(defaultDate);
  const visibleDays = isSingleDay ? 1 : 7;

  const navigate = (dir: -1 | 1): void => {
    setStartDate((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + dir * visibleDays);
      return next;
    });
  };

  const goToToday = (): void => {
    const d = new Date();
    if (!isSingleDay) d.setDate(d.getDate() - 6);
    d.setHours(0, 0, 0, 0);
    setStartDate(d);
  };

  // Build columns
  const columns = useMemo(() => {
    return Array.from({ length: visibleDays }, (_, i) => {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const dayEvents = events.filter((e) => isSameDay(new Date(e.startTime), date));
      return { date, dayEvents };
    });
  }, [startDate, visibleDays, events]);

  // Position events
  const positionedByCol = useMemo(() => {
    return columns.map((col) => {
      const positioned: PositionedEvent[] = col.dayEvents.map((evt) => {
        const sd = new Date(evt.startTime);
        const ed = new Date(evt.endTime);
        const startFrac = sd.getHours() + sd.getMinutes() / 60;
        const endFrac = ed.getHours() + ed.getMinutes() / 60;
        const top = (startFrac / 24) * 100;
        const rawHeight = ((endFrac - startFrac) / 24) * 100;
        return {
          event: evt,
          top,
          height: Math.max(rawHeight, 0.5),
          left: 0,
          width: 100,
          column: 0,
        };
      });
      return resolveOverlaps(positioned);
    });
  }, [columns]);

  // Current time indicator
  const now = new Date();
  const currentTimePct = ((now.getHours() + now.getMinutes() / 60) / 24) * 100;

  // Header label
  const headerLabel = useMemo(() => {
    if (isSingleDay) {
      return startDate.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
    }
    const end = new Date(startDate);
    end.setDate(end.getDate() + visibleDays - 1);
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    return `${startDate.toLocaleDateString('en-US', opts)} - ${end.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`;
  }, [startDate, visibleDays, isSingleDay]);

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

      {/* Column headers (hidden for single day) */}
      {!isSingleDay && (
        <div className="border-border flex border-b">
          <div className="border-border w-14 shrink-0 border-r" />
          {columns.map((col, i) => (
            <div
              key={i}
              className={cn(
                'border-border flex flex-1 flex-col items-center border-r py-2 last:border-r-0',
                isTodayDate(col.date) && 'bg-indigo-500/5'
              )}
            >
              <span
                className={cn(
                  'text-[10px] font-medium tracking-wider uppercase',
                  isTodayDate(col.date) ? 'text-indigo-400' : 'text-text-muted'
                )}
              >
                {col.date.toLocaleDateString('en-US', { weekday: 'short' })}
              </span>
              <span
                className={cn(
                  'text-xs font-medium',
                  isTodayDate(col.date) ? 'text-indigo-400' : 'text-text-secondary'
                )}
              >
                {col.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Time grid */}
      <div ref={scrollRef} className="max-h-[420px] overflow-y-auto">
        <div className="relative flex" style={{ height: SLOT_HEIGHT * 24 }}>
          {/* Time gutter */}
          <div className="w-14 shrink-0">
            {HOURS.map((h) => (
              <div
                key={h}
                className="border-border flex items-start justify-end border-r pr-2"
                style={{ height: SLOT_HEIGHT }}
              >
                <span className="text-text-muted -translate-y-1.5 text-[9px]">
                  {formatHourLabel(h)}
                </span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {columns.map((col, colIdx) => (
            <div
              key={colIdx}
              className={cn(
                'relative flex-1 border-r border-border last:border-r-0',
                isTodayDate(col.date) && 'bg-indigo-500/5'
              )}
            >
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="border-border/50 border-b"
                  style={{ height: SLOT_HEIGHT }}
                />
              ))}

              {/* Current time indicator */}
              {isTodayDate(col.date) && (
                <div
                  className="pointer-events-none absolute right-0 left-0 z-20"
                  style={{ top: `${currentTimePct}%` }}
                >
                  <div className="flex items-center">
                    <div className="size-1.5 rounded-full bg-red-500" />
                    <div className="h-px flex-1 bg-red-500/60" />
                  </div>
                </div>
              )}

              {/* Events */}
              <div className="absolute inset-0">
                {(positionedByCol[colIdx] ?? []).map((pe) => (
                  <DayEventBlock
                    key={pe.event.id}
                    pe={pe}
                    style={{
                      top: `${pe.top}%`,
                      height: `${pe.height}%`,
                      left: `calc(${pe.left}% + 2px)`,
                      width: `calc(${pe.width}% - 4px)`,
                      minHeight: '16px',
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {events.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <p className="text-text-muted text-sm">No session activity in this period</p>
        </div>
      )}
    </div>
  );
};

// =============================================================================
// MonthView Component
// =============================================================================

interface MonthViewProps {
  events: ScheduleEvent[];
  monthCount: number; // 1 or 3
}

const MAX_EVENTS_PER_DAY = 3;
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// =============================================================================
// MonthView Day Cell (extracted to reduce nesting depth)
// =============================================================================

interface MonthDayCellProps {
  date: Date;
  isCurrentMonth: boolean;
  events: ScheduleEvent[];
  compact: boolean;
}

const MonthDayCell = ({
  date,
  isCurrentMonth,
  events,
  compact,
}: Readonly<MonthDayCellProps>): React.JSX.Element => {
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

const MonthView = ({ events, monthCount }: Readonly<MonthViewProps>): React.JSX.Element => {
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

// =============================================================================
// Main Component
// =============================================================================

export const SessionSchedule = ({
  events,
  days,
}: Readonly<SessionScheduleProps>): React.JSX.Element => {
  if (days <= 1) {
    return <DayView events={events} isSingleDay />;
  }
  if (days <= 14) {
    return <DayView events={events} isSingleDay={false} />;
  }
  if (days <= 56) {
    return <MonthView events={events} monthCount={1} />;
  }
  return <MonthView events={events} monthCount={3} />;
};
