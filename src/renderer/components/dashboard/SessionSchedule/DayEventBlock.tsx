import React, { useState } from 'react';

import type { PositionedEvent } from './types';

export const DayEventBlock = ({
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
