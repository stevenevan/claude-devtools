import { JSX, useMemo, useRef, useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { HOURS, SLOT_HEIGHT } from './constants';
import { formatHourLabel, isSameDay, isTodayDate } from './dateUtils';
import { DayEventBlock } from './DayEventBlock';
import { resolveOverlaps } from './resolveOverlaps';

import type { DayViewProps, PositionedEvent } from './types';

export const DayView = ({ events, isSingleDay }: Readonly<DayViewProps>): JSX.Element => {
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
