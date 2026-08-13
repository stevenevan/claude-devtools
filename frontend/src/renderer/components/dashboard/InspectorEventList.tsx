import { JSX } from 'react';

import type { InspectorEvent } from '@shared/types/api';

export function InspectorEventList({
  events,
}: Readonly<{ events: InspectorEvent[] }>): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      {events.map((event, index) => (
        <InspectorEventCard
          key={`${event.provenance.sourceFile}:${event.provenance.line ?? index}:${event.kind}`}
          event={event}
        />
      ))}
    </div>
  );
}

export function InspectorEventCard({
  event,
}: Readonly<{ event: InspectorEvent }>): JSX.Element {
  const timestamp = event.timestamp ? new Date(event.timestamp).toLocaleString() : null;
  const label = event.role === 'user' || event.kind === 'user_message' || event.kind === 'user'
    ? 'User'
    : event.toolName
      ? `${event.toolOutputSize === null ? 'Tool call' : 'Tool result'} · ${event.toolName}`
      : `Unknown · ${event.kind || '(empty)'}`;

  return (
    <div className="border-border bg-card/40 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-foreground text-xs font-medium">{label}</span>
          {event.truncated ? (
            <span className="rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">
              truncated
            </span>
          ) : null}
        </div>
        <span className="text-muted-foreground text-[10px]">
          {event.provenance.sourceFile}:{event.provenance.line ?? '?'}
          {timestamp ? ` · ${timestamp}` : ''}
        </span>
      </div>
      {event.content ? (
        <p className="text-foreground mt-1.5 text-xs whitespace-pre-wrap break-words">
          {event.content}
        </p>
      ) : null}
      {event.toolName && event.toolOutputSize === null ? (
        <p className="text-muted-foreground mt-1.5 text-xs">
          Input withheld; shape: {event.toolInputShape ?? 'unknown'}.
        </p>
      ) : null}
      {event.toolName && event.toolOutputSize !== null ? (
        <p className="text-muted-foreground mt-1.5 text-xs">
          Output withheld; recorded size: {event.toolOutputSize.toLocaleString()} bytes.
        </p>
      ) : null}
    </div>
  );
}
