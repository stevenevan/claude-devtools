import { JSX, useEffect } from 'react';

import { useStore } from '@renderer/store';

import type { InspectorEvent } from '@shared/types/api';

export function CodexSessionDetail({ sessionId }: Readonly<{ sessionId: string }>): JSX.Element {
  const events = useStore((state) => state.inspectorSessionEvents);
  const selectedSessionId = useStore((state) => state.inspectorSelectedSessionId);
  const loading = useStore((state) => state.inspectorSessionLoading);
  const error = useStore((state) => state.inspectorSessionError);
  const loadInspectorSession = useStore((state) => state.loadInspectorSession);

  useEffect(() => {
    void loadInspectorSession(sessionId);
  }, [loadInspectorSession, sessionId]);

  if (selectedSessionId !== sessionId || loading) {
    return <p className="text-muted-foreground px-4 py-3 text-xs">Loading Codex session…</p>;
  }
  if (error) {
    return (
      <p role="alert" className="text-destructive px-4 py-3 text-xs">
        {error}
      </p>
    );
  }
  if (events.length === 0) {
    return <p className="text-muted-foreground px-4 py-3 text-xs">No session events found.</p>;
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <p className="text-muted-foreground mb-3 text-[10px]">Codex session · {sessionId}</p>
      <div className="flex flex-col gap-3">
        {events.map((event, index) => (
          <CodexEventCard key={`${event.provenance.sourceFile}:${event.provenance.line ?? index}`} event={event} />
        ))}
      </div>
    </div>
  );
}

function CodexEventCard({ event }: Readonly<{ event: InspectorEvent }>): JSX.Element {
  const label = event.toolName
    ? event.toolOutputSize === null
      ? `Tool call · ${event.toolName}`
      : `Tool result · ${event.toolName}`
    : event.role
      ? `${event.role} · ${event.kind}`
      : event.kind;

  return (
    <div className="border-border bg-card/40 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-foreground text-xs font-medium">{label}</span>
        <span className="text-muted-foreground text-[10px]">
          {event.provenance.sourceFile}:{event.provenance.line ?? '?'}
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
