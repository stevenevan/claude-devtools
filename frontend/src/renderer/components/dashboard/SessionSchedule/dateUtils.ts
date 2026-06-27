import { isSameDay, isToday } from 'date-fns';

export { isSameDay };
export const isTodayDate = isToday;

export function formatHourLabel(h: number): string {
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}
