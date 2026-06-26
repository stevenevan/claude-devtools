import type { ScheduleEvent } from '@renderer/hooks/useAnalyticsData';

export interface SessionScheduleProps {
  events: ScheduleEvent[];
  days: number;
}

export interface PositionedEvent {
  event: ScheduleEvent;
  top: number;
  height: number;
  left: number;
  width: number;
  column: number;
}

export interface DayViewProps {
  events: ScheduleEvent[];
  isSingleDay: boolean;
}

export interface MonthViewProps {
  events: ScheduleEvent[];
  monthCount: number;
}

export interface MonthDayCellProps {
  date: Date;
  isCurrentMonth: boolean;
  events: ScheduleEvent[];
  compact: boolean;
}
