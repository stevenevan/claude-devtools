import React from 'react';

import { format } from 'date-fns';
import { AlertTriangle, BookMarked, Inbox, Radio, Timer } from 'lucide-react';

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
  turn_duration: {
    bg: 'var(--event-info-bg, rgba(59, 130, 246, 0.1))',
    border: 'var(--event-info-border, rgba(59, 130, 246, 0.3))',
    text: 'var(--event-info-text, #60a5fa)',
    Icon: Timer,
    label: 'Turn Duration',
  },
  queue_operation: {
    bg: 'var(--event-queue-bg, rgba(139, 92, 246, 0.1))',
    border: 'var(--event-queue-border, rgba(139, 92, 246, 0.3))',
    text: 'var(--event-queue-text, #a78bfa)',
    Icon: Inbox,
    label: 'Queue',
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

function getTurnDurationDetail(eventGroup: EventGroup): string {
  const ms = eventGroup.eventData.durationMs;
  if (ms == null) return 'Unknown duration';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function getQueueOperationDetail(eventGroup: EventGroup): string {
  const op = eventGroup.eventData.operation ?? 'unknown';
  const content = eventGroup.eventData.queuedContent;
  const label = op === 'enqueue' ? 'Queued' : op === 'dequeue' ? 'Dequeued' : op;
  if (content) {
    const preview = content.length > 80 ? content.slice(0, 80) + '...' : content;
    return `${label}: ${preview}`;
  }
  return label;
}

function getDetail(eventGroup: EventGroup): string {
  switch (eventGroup.eventData.subtype) {
    case 'api_error':
      return getApiErrorDetail(eventGroup);
    case 'bridge_status':
      return getBridgeStatusDetail(eventGroup);
    case 'memory_saved':
      return getMemorySavedDetail(eventGroup);
    case 'turn_duration':
      return getTurnDurationDetail(eventGroup);
    case 'queue_operation':
      return getQueueOperationDetail(eventGroup);
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
        className="flex items-center gap-3 rounded-lg px-4 py-2 border"
        style={{
          backgroundColor: style.bg,
          borderColor: style.border,
        }}
      >
        <Icon size={14} className="shrink-0" style={{ color: style.text }} />
        <span
          className="shrink-0 text-xs font-medium whitespace-nowrap"
          style={{ color: style.text }}
        >
          {style.label}
        </span>
        <span className="min-w-0 truncate text-xs text-text-muted">
          {detail}
        </span>
        <span className="ml-auto shrink-0 text-xs whitespace-nowrap text-text-muted">
          {format(timestamp, 'h:mm:ss a')}
        </span>
      </div>
    </div>
  );
};
