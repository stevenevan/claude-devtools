


import { JSX } from 'react';
import { DayView } from './DayView';
import { MonthView } from './MonthView';

import type { SessionScheduleProps } from './types';

export const SessionSchedule = ({
  events,
  days,
}: Readonly<SessionScheduleProps>): JSX.Element => {
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
