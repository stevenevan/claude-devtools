import { JSX, useEffect, useState } from 'react';

import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { useStore } from '@renderer/store';

import { InspectorEventList } from './InspectorEventList';

export function CodexSessionDetail({ sessionId }: Readonly<{ sessionId: string }>): JSX.Element {
  const events = useStore((state) => state.inspectorSessionEvents);
  const selectedSessionId = useStore((state) => state.inspectorSelectedSessionId);
  const summary = useStore((state) => state.inspectorSessionSummary);
  const diagnostics = useStore((state) => state.inspectorSessionDiagnostics);
  const scanLimited = useStore((state) => state.inspectorSessionScanLimited);
  const hasMore = useStore((state) => state.inspectorSessionHasMore);
  const loading = useStore((state) => state.inspectorSessionLoading);
  const error = useStore((state) => state.inspectorSessionError);
  const loadInspectorSession = useStore((state) => state.loadInspectorSession);
  const loadMoreInspectorSession = useStore((state) => state.loadMoreInspectorSession);
  const setInspectorTaskGraphSelection = useStore((state) => state.setInspectorTaskGraphSelection);
  const setActiveActivity = useStore((state) => state.setActiveActivity);
  const [relatedTaskGraph, setRelatedTaskGraph] = useState<string | null>(null);
  const [taskGraphLookupError, setTaskGraphLookupError] = useState<string | null>(null);

  useEffect(() => {
    void loadInspectorSession(sessionId);
  }, [loadInspectorSession, sessionId]);

  useEffect(() => {
    let active = true;
    setTaskGraphLookupError(null);
    void api
      .listSourceTaskGraphs('codex')
      .then((result) => {
        if (!active) return;
        setRelatedTaskGraph(
          result.capability.state === 'available' && result.items.some((graph) => graph.id === sessionId)
            ? sessionId
            : null
        );
      })
      .catch((error: unknown) => {
        if (active) setTaskGraphLookupError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, [sessionId]);

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

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="mb-3">
        <p className="text-muted-foreground text-[10px]">
          Codex session · {summary?.sessionId ?? sessionId}
        </p>
        {summary ? (
          <p className="text-muted-foreground mt-1 text-[10px]">
            {summary.project || 'Unknown project'} · {summary.turnCount} turn
            {summary.turnCount === 1 ? '' : 's'} ·{' '}
            {summary.eventCount === null
              ? 'event count incomplete'
              : `${summary.eventCount} event${summary.eventCount === 1 ? '' : 's'}`}
          </p>
        ) : null}
        {summary ? (
          <p className="text-muted-foreground mt-1 font-mono text-[10px]">
            {summary.provenance.sourceFile}:{summary.provenance.line ?? '?'}
          </p>
        ) : null}
      </div>

      {diagnostics.length > 0 ? (
        <div role="status" className="border-border bg-amber-500/10 mb-3 rounded-md border px-3 py-2">
          <p className="text-amber-500 text-[10px] font-medium">Some session details need review</p>
          <ul className="text-muted-foreground mt-1 list-disc pl-4 text-[10px]">
            {diagnostics.map((diagnostic) => (
              <li key={diagnostic}>{diagnostic}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {scanLimited ? (
        <p role="status" className="text-muted-foreground mb-3 text-[10px]">
          This session is truncated at the read safety limit.
        </p>
      ) : null}

      {relatedTaskGraph ? (
        <Button
          variant="outline"
          size="sm"
          className="mb-3 self-start"
          onClick={() => {
            setInspectorTaskGraphSelection(relatedTaskGraph);
            setActiveActivity('taskGraph');
          }}
        >
          Open related Task Graph
        </Button>
      ) : (
        <p role="status" className="text-muted-foreground mb-3 text-[10px]">
          No related Task Graph found for this session.
          {taskGraphLookupError ? ` Graph lookup failed: ${taskGraphLookupError}` : ''}
        </p>
      )}

      {events.length === 0 ? (
        <p className="text-muted-foreground text-xs">No session events found.</p>
      ) : (
        <InspectorEventList events={events} />
      )}

      {hasMore ? (
        <Button
          variant="outline"
          size="sm"
          className="mt-4 self-start"
          disabled={loading}
          onClick={() => void loadMoreInspectorSession()}
        >
          Load more events
        </Button>
      ) : null}
    </div>
  );
}
