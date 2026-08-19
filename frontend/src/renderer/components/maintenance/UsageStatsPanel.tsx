import { JSX, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import { formatBytes } from '@renderer/utils/formatters';
import { createSourceRequestGate } from './sourceRequestGate';
import { Activity, AlertTriangle, RefreshCw } from 'lucide-react';

import type {
  InspectorDiagnostic,
  SourceKind,
  TelemetryDetail,
  TelemetryItem,
  UsageSummary,
} from '@shared/types/api';

interface UsageStatsPanelProps {
  source: SourceKind;
}

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const sourceRoot = (source: SourceKind): string => (source === 'codex' ? '~/.codex' : '~/.claude');

export const UsageStatsPanel = ({ source }: Readonly<UsageStatsPanelProps>): JSX.Element => {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [events, setEvents] = useState<TelemetryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<TelemetryDetail | null>(null);
  const [eventLoading, setEventLoading] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);
  const requestGate = useRef(createSourceRequestGate());

  const load = useCallback(async (): Promise<void> => {
    const summaryRequest = requestGate.current.begin('summary');
    const eventsRequest = requestGate.current.begin('events');
    requestGate.current.begin('detail');
    setSummaryLoading(true);
    setEventsLoading(true);
    setSummary(null);
    setEvents([]);
    setSelectedId(null);
    setSelectedEvent(null);
    setSummaryError(null);
    setEventsError(null);
    setNextCursor(null);
    setEventLoading(false);
    setEventError(null);
    try {
      const result = await api.readSourceUsageSummary(source);
      if (!requestGate.current.isCurrent('summary', summaryRequest)) return;
      setSummary(result);
    } catch (error) {
      if (!requestGate.current.isCurrent('summary', summaryRequest)) return;
      setSummary(null);
      setSummaryError(errText(error));
    } finally {
      if (requestGate.current.isCurrent('summary', summaryRequest)) setSummaryLoading(false);
    }
    try {
      const page = await api.listSourceTelemetry(source, null, 50);
      if (!requestGate.current.isCurrent('events', eventsRequest)) return;
      setEvents(page.items);
      setNextCursor(page.nextCursor);
      if (page.diagnostics.length > 0) setEventsError(diagnosticText(page.diagnostics));
    } catch (error) {
      if (!requestGate.current.isCurrent('events', eventsRequest)) return;
      setEvents([]);
      setEventsError(errText(error));
    } finally {
      if (requestGate.current.isCurrent('events', eventsRequest)) setEventsLoading(false);
    }
  }, [source]);

  useEffect(() => {
    requestGate.current.switchSource();
    setSelectedId(null);
    setSelectedEvent(null);
    setEventError(null);
    void load();
  }, [load]);

  const loadMore = async (): Promise<void> => {
    if (!nextCursor) return;
    const request = requestGate.current.begin('events');
    setEventsLoading(true);
    try {
      const page = await api.listSourceTelemetry(source, nextCursor, 50);
      if (!requestGate.current.isCurrent('events', request)) return;
      setEvents((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
      if (page.diagnostics.length > 0) setEventsError(diagnosticText(page.diagnostics));
    } catch (error) {
      if (!requestGate.current.isCurrent('events', request)) return;
      setEventsError(errText(error));
    } finally {
      if (requestGate.current.isCurrent('events', request)) setEventsLoading(false);
    }
  };

  const selectEvent = async (id: string): Promise<void> => {
    const request = requestGate.current.begin('detail');
    setSelectedId(id);
    setSelectedEvent(null);
    setEventError(null);
    setEventLoading(true);
    try {
      const result = await api.readSourceTelemetry(source, id);
      if (!requestGate.current.isCurrent('detail', request)) return;
      setSelectedEvent(result);
    } catch (error) {
      if (!requestGate.current.isCurrent('detail', request)) return;
      setEventError(errText(error));
    } finally {
      if (requestGate.current.isCurrent('detail', request)) setEventLoading(false);
    }
  };

  const busy = summaryLoading || eventsLoading;

  return (
    <div className="flex flex-col">
      <div className="border-border/50 flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Activity className="text-muted-foreground size-4" aria-hidden="true" />
            <p className="text-foreground text-sm font-medium">Usage &amp; telemetry</p>
          </div>
          <p className="text-muted-foreground mt-1 max-w-2xl text-xs">
            Safe summaries from {sourceRoot(source)}. Values are allowlisted and bounded; raw
            telemetry payloads never leave the local reader.
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void load()}>
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>

      <UsageSummarySection summary={summary} loading={summaryLoading} error={summaryError} />
      <TelemetrySection
        events={events}
        loading={eventsLoading}
        error={eventsError}
        selectedId={selectedId}
        selectedEvent={selectedEvent}
        eventLoading={eventLoading}
        eventError={eventError}
        onSelect={(id) => void selectEvent(id)}
        hasMore={nextCursor !== null}
        onLoadMore={() => void loadMore()}
      />
    </div>
  );
};

interface UsageSummarySectionProps {
  summary: UsageSummary | null;
  loading: boolean;
  error: string | null;
}

const UsageSummarySection = ({
  summary,
  loading,
  error,
}: Readonly<UsageSummarySectionProps>): JSX.Element => (
  <section className="border-border/50 border-b px-4 py-4">
    <p className="text-foreground text-xs font-medium">Usage summary</p>
    {error && <ErrorMessage message={error} />}
    {loading && (
      <p role="status" className="text-muted-foreground mt-3 text-xs">
        Loading usage summary…
      </p>
    )}
    {!loading && !error && !summary && (
      <p className="text-muted-foreground mt-3 text-xs">Usage summary is unavailable.</p>
    )}
    {!loading && summary && (
      <>
        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          <Metric label="Period" value={summary.period ?? 'Not reported'} />
          <Metric label="Turns" value={formatNumber(summary.turns)} />
          <Metric label="Tokens" value={formatNumber(summary.tokens)} />
          <Metric label="Cost" value={summary.cost === null ? 'Not reported' : String(summary.cost)} />
        </div>
        <div className="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
          <span>Source: {summary.source === 'codex' ? 'Codex' : 'Claude Code'}</span>
          {summary.sourceFile && (
            <span className="max-w-full break-all select-text">Provenance: {summary.sourceFile}</span>
          )}
          {summary.revision && <span>Revision: {summary.revision}</span>}
          {summary.stale && <span className="text-warning">Stale snapshot</span>}
        </div>
        {summary.state !== 'available' && (
          <p className="text-muted-foreground mt-3 text-xs">{summary.state} · no complete summary.</p>
        )}
        <Diagnostics diagnostics={summary.diagnostics} />
      </>
    )}
  </section>
);

const Metric = ({ label, value }: Readonly<{ label: string; value: string }>): JSX.Element => (
  <div className="border-border/50 rounded-md border px-3 py-2">
    <dt className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">{label}</dt>
    <dd className="text-foreground mt-1 truncate text-sm font-medium" title={value}>
      {value}
    </dd>
  </div>
);

interface TelemetrySectionProps {
  events: TelemetryItem[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  selectedEvent: TelemetryDetail | null;
  eventLoading: boolean;
  eventError: string | null;
  onSelect: (id: string) => void;
  hasMore: boolean;
  onLoadMore: () => void;
}

const TelemetrySection = ({
  events,
  loading,
  error,
  selectedId,
  selectedEvent,
  eventLoading,
  eventError,
  onSelect,
  hasMore,
  onLoadMore,
}: Readonly<TelemetrySectionProps>): JSX.Element => (
  <section className="px-4 py-4">
    <div className="flex items-center justify-between gap-2">
      <div>
        <p className="text-foreground text-xs font-medium">Telemetry events</p>
        <p className="text-muted-foreground mt-0.5 text-[11px]">Select an event for safe fields only.</p>
      </div>
      {hasMore && (
        <Button variant="ghost" size="sm" disabled={loading} onClick={onLoadMore}>
          Load more
        </Button>
      )}
    </div>
    {error && <ErrorMessage message={error} />}
    {loading && events.length === 0 && (
      <p role="status" className="text-muted-foreground mt-3 text-xs">
        Loading telemetry…
      </p>
    )}
    {!loading && !error && events.length === 0 && (
      <p className="text-muted-foreground mt-3 text-xs">No telemetry events were found.</p>
    )}
    {events.length > 0 && (
      <div className="mt-3 flex flex-col gap-3 lg:flex-row">
        <div aria-label="Telemetry events" className="flex max-h-96 min-w-0 flex-col gap-1.5 lg:w-72">
          {events.map((event) => (
            <Button
              key={event.id}
              variant="ghost"
              aria-current={event.id === selectedId || undefined}
              onClick={() => onSelect(event.id)}
              className={cn(
                'h-auto w-full min-w-0 flex-col items-start gap-0.5 rounded-md border px-2.5 py-2 text-left',
                event.id === selectedId
                  ? 'bg-card/50 border-border'
                  : 'border-border/50 hover:bg-card/30'
              )}
            >
              <span className="text-foreground w-full truncate font-mono text-xs">{event.id}</span>
              <span className="text-muted-foreground text-[10px]">
                {event.kind ?? 'event'} · {formatBytes(event.sizeBytes)}
              </span>
            </Button>
          ))}
        </div>
        <TelemetryDetailView
          selectedId={selectedId}
          detail={selectedEvent}
          loading={eventLoading}
          error={eventError}
        />
      </div>
    )}
  </section>
);

const TelemetryDetailView = ({
  selectedId,
  detail,
  loading,
  error,
}: Readonly<{
  selectedId: string | null;
  detail: TelemetryDetail | null;
  loading: boolean;
  error: string | null;
}>): JSX.Element => {
  if (!selectedId) {
    return <p className="text-muted-foreground min-w-0 flex-1 text-xs">Select an event to inspect it.</p>;
  }
  if (loading) {
    return (
      <p role="status" className="text-muted-foreground min-w-0 flex-1 text-xs">
        Loading event…
      </p>
    );
  }
  if (error) return <ErrorMessage message={error} />;
  if (!detail) return <p className="text-muted-foreground text-xs">Event details are unavailable.</p>;
  return (
    <div className="border-border/50 min-w-0 flex-1 rounded-md border p-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className="text-foreground font-medium">{detail.item.kind ?? 'event'}</span>
        <span className="text-muted-foreground">{detail.item.timestamp ?? 'time not reported'}</span>
        <span className="text-muted-foreground">{detail.item.redaction}</span>
        <span className="text-muted-foreground max-w-full break-all select-text">
          Provenance: {detail.item.provenance.sourceFile}
        </span>
        {detail.item.provenance.archived && <span className="text-muted-foreground">Archived</span>}
      </div>
      {detail.summary.length > 0 ? (
        <dl className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2">
          {detail.summary.map((field) => (
            <div key={field.name} className="min-w-0">
              <dt className="text-muted-foreground text-[10px]">{field.name}</dt>
              <dd className="text-foreground mt-0.5 truncate font-mono text-xs" title={field.value}>
                {field.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-muted-foreground mt-3 text-xs">No allowlisted fields were present.</p>
      )}
      <Diagnostics diagnostics={detail.diagnostics} />
    </div>
  );
};

const ErrorMessage = ({ message }: Readonly<{ message: string }>): JSX.Element => (
  <div role="alert" className="bg-destructive/10 text-destructive mt-3 rounded-md px-3 py-2 text-xs">
    {message}
  </div>
);

const Diagnostics = ({ diagnostics }: Readonly<{ diagnostics: InspectorDiagnostic[] }>): JSX.Element | null => {
  if (diagnostics.length === 0) return null;
  return (
    <div className="text-muted-foreground mt-3 flex items-start gap-2 text-[11px]" role="status">
      <AlertTriangle className="text-warning mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{diagnosticText(diagnostics)}</span>
    </div>
  );
};

const diagnosticText = (diagnostics: InspectorDiagnostic[]): string =>
  diagnostics.map((diagnostic) => diagnostic.message).join(' ');

const formatNumber = (value: number | null): string =>
  value === null ? 'Not reported' : value.toLocaleString();
