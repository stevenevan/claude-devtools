import { differenceInCalendarDays, differenceInDays, format, isToday, isYesterday } from 'date-fns';

import { DATE_CATEGORY_ORDER } from '../types/tabs';

import type { Session } from '../types/data';
import type { DateCategory, DateGroupedSessions } from '../types/tabs';

export function groupSessionsByDate(sessions: Session[]): DateGroupedSessions {
  const now = new Date();

  return sessions.reduce<DateGroupedSessions>(
    (acc, session) => {
      const sessionDate = new Date(session.createdAt);

      if (isToday(sessionDate)) {
        acc.Today.push(session);
      } else if (isYesterday(sessionDate)) {
        acc.Yesterday.push(session);
      } else if (differenceInDays(now, sessionDate) <= 7) {
        acc['Previous 7 Days'].push(session);
      } else {
        acc.Older.push(session);
      }

      return acc;
    },
    { Today: [], Yesterday: [], 'Previous 7 Days': [], Older: [] }
  );
}

export function getNonEmptyCategories(grouped: DateGroupedSessions): DateCategory[] {
  return DATE_CATEGORY_ORDER.filter((category) => grouped[category].length > 0);
}

export function getDateGroupLabel(timestamp: number, now: Date = new Date()): string {
  const date = new Date(timestamp);
  const calendarDaysAgo = differenceInCalendarDays(now, date);

  if (calendarDaysAgo === 0) return 'Today';
  if (calendarDaysAgo === 1) return 'Yesterday';
  return format(date, 'd MMMM');
}

// pinnedSessionIds is ordered most-recently-pinned first; that order is preserved for pinned output
export function separatePinnedSessions(
  sessions: Session[],
  pinnedSessionIds: string[]
): { pinned: Session[]; unpinned: Session[] } {
  if (pinnedSessionIds.length === 0) {
    return { pinned: [], unpinned: sessions };
  }

  const pinnedSet = new Set(pinnedSessionIds);
  const sessionMap = new Map(sessions.map((s) => [s.id, s]));

  const pinned: Session[] = [];
  for (const id of pinnedSessionIds) {
    const session = sessionMap.get(id);
    if (session) {
      pinned.push(session);
    }
  }

  const unpinned = sessions.filter((s) => !pinnedSet.has(s.id));

  return { pinned, unpinned };
}
