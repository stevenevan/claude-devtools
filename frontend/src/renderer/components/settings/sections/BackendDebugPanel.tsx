import { JSX, useEffect, useRef, useState } from 'react';
import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@renderer/components/ui/field';
import { Activity, Database, RefreshCw, Trash2 } from 'lucide-react';

import type { BackendCacheStats, BackendTimingSummary } from '@shared/types/api';

const REFRESH_INTERVAL_MS = 2000;

function formatMs(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value < 10) return `${value.toFixed(2)}ms`;
  if (value < 1000) return `${value.toFixed(0)}ms`;
  return `${(value / 1000).toFixed(2)}s`;
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export const BackendDebugPanel = (): JSX.Element => {
  const [timings, setTimings] = useState<BackendTimingSummary[]>([]);
  const [stats, setStats] = useState<BackendCacheStats | null>(null);
  const [capacityDraft, setCapacityDraft] = useState<number>(50);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = async (): Promise<void> => {
    try {
      const [t, s] = await Promise.all([api.getBackendTimings(), api.getCacheStats()]);
      setTimings(t);
      setStats(s);
      setCapacityDraft(s.capacity);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed');
    }
  };

  useEffect(() => {
    void refresh();
    intervalRef.current = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-text inline-flex items-center gap-2 text-base font-semibold">
          <Activity className="size-4" />
          Backend debug
        </h2>
        <p className="text-text-muted mt-1 text-xs">
          Per-command latency percentiles and session-cache statistics. Refreshes every{' '}
          {REFRESH_INTERVAL_MS}ms.
        </p>
      </div>

      {error && (
        <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-xs">
          {error}
        </div>
      )}

      <section className="border-border bg-surface-raised rounded-md border p-3">
        <h3 className="text-text-secondary inline-flex items-center gap-2 text-sm font-medium">
          <Database className="size-4" />
          Session cache
        </h3>
        {stats ? (
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <Stat label="Hit rate" value={formatPct(stats.hitRate)} />
            <Stat label="Hits" value={String(stats.hits)} />
            <Stat label="Misses" value={String(stats.misses)} />
            <Stat label="Evicts" value={String(stats.evicts)} />
            <Stat label="Capacity" value={String(stats.capacity)} />
            <Stat label="In-use" value={String(stats.size)} />
          </div>
        ) : (
          <p className="text-text-muted mt-2 text-xs">Loading…</p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Field className="flex-row items-center gap-2">
            <FieldLabel htmlFor="backend-cache-capacity" className="text-text-muted text-[11px]">
              Capacity:
            </FieldLabel>
            <input
              id="backend-cache-capacity"
              type="number"
              min={1}
              max={2000}
              value={capacityDraft}
              onChange={(e) => setCapacityDraft(Number.parseInt(e.target.value || '0', 10))}
              aria-describedby="backend-cache-capacity-description"
              className="border-border bg-surface text-text w-24 rounded-sm border px-2 py-1 text-xs"
            />
            <FieldDescription id="backend-cache-capacity-description" className="sr-only">
              Maximum number of entries kept in the session cache.
            </FieldDescription>
          </Field>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await api.setCacheCapacity(Math.max(1, capacityDraft));
              await refresh();
            }}
          >
            Apply
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await api.clearSessionCache();
              await refresh();
            }}
            className="text-destructive gap-1"
          >
            <Trash2 className="size-3" />
            Clear cache
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void refresh()}
            className="ml-auto gap-1"
          >
            <RefreshCw className="size-3" />
            Refresh
          </Button>
        </div>
      </section>

      <section className="border-border bg-surface-raised rounded-md border p-3">
        <h3 className="text-text-secondary text-sm font-medium">Command latencies</h3>
        {timings.length === 0 ? (
          <p className="text-text-muted mt-2 text-xs">No samples yet.</p>
        ) : (
          <table className="mt-3 w-full text-[11px]">
            <thead className="text-text-muted">
              <tr>
                <th className="py-1 text-left">Command</th>
                <th className="py-1 text-right">n</th>
                <th className="py-1 text-right">p50</th>
                <th className="py-1 text-right">p95</th>
                <th className="py-1 text-right">p99</th>
                <th className="py-1 text-right">max</th>
              </tr>
            </thead>
            <tbody>
              {timings.map((row) => (
                <tr key={row.command} className="border-border border-t">
                  <td className="py-1 font-mono">{row.command}</td>
                  <td className="py-1 text-right">{row.count}</td>
                  <td className="py-1 text-right">{formatMs(row.p50Ms)}</td>
                  <td className="py-1 text-right">{formatMs(row.p95Ms)}</td>
                  <td className="py-1 text-right">{formatMs(row.p99Ms)}</td>
                  <td className="py-1 text-right">{formatMs(row.maxMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};

interface StatProps {
  label: string;
  value: string;
}

const Stat = ({ label, value }: Readonly<StatProps>): JSX.Element => (
  <div className="border-border bg-surface flex flex-col gap-0.5 rounded-md border p-2">
    <span className="text-text-muted text-[10px] tracking-wider uppercase">{label}</span>
    <span className="text-text text-sm font-medium">{value}</span>
  </div>
);
