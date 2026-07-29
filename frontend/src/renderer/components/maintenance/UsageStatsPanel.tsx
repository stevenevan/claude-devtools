import { JSX, useEffect, useState } from 'react';
import { api } from '@renderer/api';
import { CodeBlockViewer } from '@renderer/components/chat/viewers';
import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import { formatBytes } from '@renderer/utils/formatters';
import { RefreshCw } from 'lucide-react';

import type { FileMeta } from '@shared/types/api';

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

// Read-only view of the CLI's own local usage data: ~/.claude/stats-cache.json
// and ~/.claude/telemetry/*.json. Separate from the app's Analytics dashboard,
// which derives its own metrics from session transcripts. This panel writes nothing.
export const UsageStatsPanel = (): JSX.Element => {
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  const [events, setEvents] = useState<FileMeta[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<unknown>(null);
  const [eventLoading, setEventLoading] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);

  const loadStats = async (): Promise<void> => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const result = await api.readUsageStats();
      setStats(
        result && typeof result === 'object' && !Array.isArray(result)
          ? (result as Record<string, unknown>)
          : null
      );
    } catch (err) {
      setStatsError(errText(err));
    } finally {
      setStatsLoading(false);
    }
  };

  const loadEvents = async (): Promise<void> => {
    setEventsLoading(true);
    setEventsError(null);
    try {
      setEvents(await api.listTelemetryEvents());
    } catch (err) {
      setEventsError(errText(err));
    } finally {
      setEventsLoading(false);
    }
  };

  useEffect(() => {
    void loadStats();
    void loadEvents();
  }, []);

  const selectEvent = async (name: string): Promise<void> => {
    setSelectedName(name);
    setSelectedEvent(null);
    setEventError(null);
    setEventLoading(true);
    try {
      setSelectedEvent(await api.readTelemetryEvent(name));
    } catch (err) {
      setEventError(errText(err));
    } finally {
      setEventLoading(false);
    }
  };

  const refresh = (): void => {
    void loadStats();
    void loadEvents();
  };

  return (
    <div className="flex flex-col">
      <div className="border-border/50 flex items-start justify-between gap-2 border-b px-4 py-3">
        <div>
          <p className="text-foreground text-sm font-medium">Usage</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Read-only view of the CLI&apos;s own local usage data: ~/.claude/stats-cache.json and
            telemetry/*.json. This is the CLI&apos;s raw cache, separate from the Analytics dashboard.
            Nothing here writes.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={statsLoading || eventsLoading}
          onClick={refresh}
        >
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>

      <StatsSection stats={stats} loading={statsLoading} error={statsError} />

      <TelemetrySection
        events={events}
        loading={eventsLoading}
        error={eventsError}
        selectedName={selectedName}
        selectedEvent={selectedEvent}
        eventLoading={eventLoading}
        eventError={eventError}
        onSelect={(name) => void selectEvent(name)}
      />
    </div>
  );
};

interface StatsSectionProps {
  stats: Record<string, unknown> | null;
  loading: boolean;
  error: string | null;
}

const StatsSection = ({ stats, loading, error }: Readonly<StatsSectionProps>): JSX.Element => (
  <div className="border-border/50 border-b px-4 py-3">
    <p className="text-foreground mb-2 text-xs font-medium">Stats cache</p>

    {error && (
      <div
        role="alert"
        className="bg-destructive/10 text-destructive mb-2 rounded-md px-3 py-2 text-xs"
      >
        {error}
      </div>
    )}

    {loading && (
      <p role="status" className="text-muted-foreground text-xs">
        Loading…
      </p>
    )}

    {!loading && !error && !stats && (
      <p className="text-muted-foreground text-xs">No stats-cache.json found under ~/.claude.</p>
    )}

    {!loading && stats && (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          {Object.entries(stats)
            .filter(([, value]) => isScalar(value))
            .map(([key, value]) => (
              <div key={key} className="flex items-center gap-2">
                <span className="font-mono text-xs">{key}</span>
                <span className="text-muted-foreground text-xs">{String(value)}</span>
              </div>
            ))}
        </div>
        {Object.entries(stats)
          .filter(([, value]) => !isScalar(value))
          .map(([key, value]) => (
            <div key={key}>
              <p className="text-foreground mb-1 text-xs font-medium">{key}</p>
              <CodeBlockViewer fileName={key} content={JSON.stringify(value, null, 2)} language="json" />
            </div>
          ))}
      </div>
    )}
  </div>
);

interface TelemetrySectionProps {
  events: FileMeta[];
  loading: boolean;
  error: string | null;
  selectedName: string | null;
  selectedEvent: unknown;
  eventLoading: boolean;
  eventError: string | null;
  onSelect: (name: string) => void;
}

const TelemetrySection = ({
  events,
  loading,
  error,
  selectedName,
  selectedEvent,
  eventLoading,
  eventError,
  onSelect,
}: Readonly<TelemetrySectionProps>): JSX.Element => (
  <div className="px-4 py-3">
    <p className="text-foreground mb-2 text-xs font-medium">Telemetry events</p>

    {error && (
      <div
        role="alert"
        className="bg-destructive/10 text-destructive mb-2 rounded-md px-3 py-2 text-xs"
      >
        {error}
      </div>
    )}

    {loading && (
      <p role="status" className="text-muted-foreground text-xs">
        Loading…
      </p>
    )}

    {!loading && !error && events.length === 0 && (
      <p className="text-muted-foreground text-xs">
        No telemetry events found under ~/.claude/telemetry.
      </p>
    )}

    {!loading && events.length > 0 && (
      <div className="flex gap-4">
        <div
          aria-label="Telemetry events"
          className="flex max-h-96 w-64 shrink-0 flex-col gap-1.5 overflow-y-auto"
        >
          {events.map((event) => (
            <EventRow
              key={event.name}
              event={event}
              selected={event.name === selectedName}
              onSelect={() => onSelect(event.name)}
            />
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <EventContent
            selectedName={selectedName}
            event={selectedEvent}
            loading={eventLoading}
            error={eventError}
          />
        </div>
      </div>
    )}
  </div>
);

interface EventRowProps {
  event: FileMeta;
  selected: boolean;
  onSelect: () => void;
}

const EventRow = ({ event, selected, onSelect }: Readonly<EventRowProps>): JSX.Element => (
  <Button
    variant="ghost"
    aria-current={selected || undefined}
    onClick={onSelect}
    className={cn(
      'h-auto w-full min-w-0 flex-col items-start gap-0.5 rounded-md border px-2.5 py-2 text-left',
      selected ? 'bg-card/50 border-border' : 'border-border/50 hover:bg-card/30'
    )}
  >
    <span className="text-foreground w-full truncate font-mono text-xs">{event.name}</span>
    <span className="text-muted-foreground text-[10px]">
      {formatBytes(event.sizeBytes)} · {new Date(event.mtime).toLocaleString()}
    </span>
  </Button>
);

interface EventContentProps {
  selectedName: string | null;
  event: unknown;
  loading: boolean;
  error: string | null;
}

const EventContent = ({
  selectedName,
  event,
  loading,
  error,
}: Readonly<EventContentProps>): JSX.Element => {
  if (!selectedName) {
    return <p className="text-muted-foreground text-xs">Select an event to view its contents.</p>;
  }
  if (loading) {
    return (
      <p role="status" className="text-muted-foreground text-xs">
        Loading…
      </p>
    );
  }
  if (error) {
    return (
      <div role="alert" className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-xs">
        {error}
      </div>
    );
  }
  if (event === null) {
    return <p className="text-muted-foreground text-xs">Select an event to view its contents.</p>;
  }
  return (
    <CodeBlockViewer fileName={selectedName} content={JSON.stringify(event, null, 2)} language="json" />
  );
};
