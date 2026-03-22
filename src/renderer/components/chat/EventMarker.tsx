import React from 'react';

import { COLOR_TEXT_MUTED } from '@renderer/constants/cssVariables';
import { format } from 'date-fns';
import { AlertTriangle, BookMarked, Radio } from 'lucide-react';

import type { EventGroup } from '@renderer/types/groups';

interface EventMarkerProps {
  eventGroup: EventGroup;
}

const EVENT_STYLES = {
  api_error: {
    bg: 'var(--warning-bg)',
    border: 'var(--warning-border)',
    text: 'var(--warning-text)',
    Icon: AlertTriangle,
    label: 'API Error',
  },
  bridge_status: {
    bg: 'var(--event-info-bg, rgba(59, 130, 246, 0.1))',
    border: 'var(--event-info-border, rgba(59, 130, 246, 0.3))',
    text: 'var(--event-info-text, #60a5fa)',
    Icon: Radio,
    label: 'Remote Control',
  },
  memory_saved: {
    bg: 'var(--event-success-bg, rgba(34, 197, 94, 0.1))',
    border: 'var(--event-success-border, rgba(34, 197, 94, 0.3))',
    text: 'var(--event-success-text, #4ade80)',
    Icon: BookMarked,
    label: 'Memory Saved',
  },
} as const;

function getApiErrorDetail(eventGroup: EventGroup): string {
  const { eventData } = eventGroup;
  const parts: string[] = [];

  if (eventData.errorMessage) {
    parts.push(eventData.errorMessage);
  } else if (eventData.errorType) {
    parts.push(eventData.errorType);
  }

  if (eventData.errorStatus) {
    parts.push(`(${eventData.errorStatus})`);
  }

  if (eventData.retryAttempt != null && eventData.maxRetries != null) {
    const retryMs = eventData.retryInMs != null ? ` in ${Math.round(eventData.retryInMs)}ms` : '';
    parts.push(`\u2014 retry ${eventData.retryAttempt}/${eventData.maxRetries}${retryMs}`);
  }

  return parts.join(' ') || 'Unknown error';
}

function getBridgeStatusDetail(eventGroup: EventGroup): string {
  const { eventData } = eventGroup;
  return eventData.bridgeContent ?? 'Remote control active';
}

function getMemorySavedDetail(eventGroup: EventGroup): string {
  const { eventData } = eventGroup;
  const verb = eventData.memoryVerb ?? 'Saved';
  const count = eventData.writtenPaths?.length ?? 0;
  return `${verb} \u2014 ${count} ${count === 1 ? 'file' : 'files'}`;
}

function getDetail(eventGroup: EventGroup): string {
  switch (eventGroup.eventData.subtype) {
    case 'api_error':
      return getApiErrorDetail(eventGroup);
    case 'bridge_status':
      return getBridgeStatusDetail(eventGroup);
    case 'memory_saved':
      return getMemorySavedDetail(eventGroup);
    default:
      return eventGroup.eventData.subtype;
  }
}

/**
 * EventMarker displays a lightweight inline marker for system events
 * (api_error, bridge_status, memory_saved) in the session timeline.
 */
export const EventMarker = ({ eventGroup }: Readonly<EventMarkerProps>): React.JSX.Element => {
  const { timestamp, eventData } = eventGroup;
  const style = EVENT_STYLES[eventData.subtype as keyof typeof EVENT_STYLES] ?? EVENT_STYLES.api_error;
  const { Icon } = style;
  const detail = getDetail(eventGroup);

  return (
    <div className="my-3">
      <div
        className="flex items-center gap-3 rounded-lg px-4 py-2"
        style={{
          backgroundColor: style.bg,
          border: `1px solid ${style.border}`,
        }}
      >
        <Icon size={14} style={{ color: style.text, flexShrink: 0 }} />
        <span
          className="shrink-0 text-xs font-medium whitespace-nowrap"
          style={{ color: style.text }}
        >
          {style.label}
        </span>
        <span
          className="min-w-0 truncate text-xs"
          style={{ color: COLOR_TEXT_MUTED }}
        >
          {detail}
        </span>
        <span
          className="ml-auto shrink-0 text-xs whitespace-nowrap"
          style={{ color: COLOR_TEXT_MUTED }}
        >
          {format(timestamp, 'h:mm:ss a')}
        </span>
      </div>
    </div>
  );
};
