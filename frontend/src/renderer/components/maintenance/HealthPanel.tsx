import { JSX, useEffect } from 'react';
import { useStore } from '@renderer/store';
import { AlertTriangle, Flag, HeartPulse, RotateCcw, Server } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const STALE_DAYS = 30;

function formatAge(ms: number): string {
  const diff = Date.now() - ms;
  const days = Math.floor(diff / DAY_MS);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'} ago`;
  const hours = Math.floor(diff / HOUR_MS);
  if (hours >= 1) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const minutes = Math.max(1, Math.floor(diff / MINUTE_MS));
  return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
}

// Read-only Week 14 panel: last cleanup, last self-update outcome, daemon
// liveness (by mtime — a guess, never a verdict), active mode flags, and a
// daemon.log tail. Zero write/delete actions anywhere.
export const HealthPanel = (): JSX.Element => {
  const { health, loadHealth } = useStore(
    useShallow((s) => ({ health: s.health, loadHealth: s.loadHealth }))
  );

  useEffect(() => {
    void loadHealth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!health) {
    return <p className="text-muted-foreground px-4 py-3 text-xs">Loading health…</p>;
  }

  const isStale = health.lastCleanupMs === 0 || Date.now() - health.lastCleanupMs > STALE_DAYS * DAY_MS;
  const activeFlags = health.flags.filter((f) => f.present);

  return (
    <div className="flex flex-col">
      <div className="border-border/50 border-b px-4 py-3">
        <p className="text-foreground text-sm font-medium">Health</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Read-only snapshot of the ~/.claude install. Nothing on this panel writes or deletes
          anything.
        </p>
      </div>

      {isStale && (
        <div className="border-border/50 bg-amber-500/10 text-amber-500 flex items-center gap-2 border-b px-4 py-2 text-xs">
          <AlertTriangle className="size-3.5 shrink-0" />
          Storage hasn&apos;t been reviewed in a while — see the cleanup tabs above.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
        <div className="border-border/50 rounded-md border p-3">
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            <RotateCcw className="size-3.5" />
            Last cleanup
          </div>
          <p className="text-foreground mt-1 text-sm">
            {health.lastCleanupMs === 0 ? 'Never' : `Cleaned ${formatAge(health.lastCleanupMs)}`}
          </p>
        </div>

        <div className="border-border/50 rounded-md border p-3">
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            <HeartPulse className="size-3.5" />
            Last update
          </div>
          {health.lastUpdateParseErr ? (
            <>
              <p className="text-foreground mt-1 text-sm">
                Unrecognized format
                <span className="ml-2 rounded-sm bg-amber-500/15 px-1 py-px text-[9px] font-medium text-amber-500">
                  parse error
                </span>
              </p>
              <p className="text-muted-foreground mt-0.5 truncate text-xs" title={health.lastUpdateRaw}>
                {health.lastUpdateRaw || '(empty)'}
              </p>
            </>
          ) : (
            <p className="text-foreground mt-1 text-sm">
              {health.lastUpdateStatus || 'Never'}
              {health.lastUpdateVersion && ` — v${health.lastUpdateVersion}`}
            </p>
          )}
        </div>

        <div className="border-border/50 rounded-md border p-3">
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            <Server className="size-3.5" />
            Daemon
          </div>
          <p className="text-foreground mt-1 text-sm">
            {health.daemonPresent
              ? `Last wrote ${formatAge(health.daemonLastWriteMs)} (guess, from file mtime)`
              : 'Not running, or absent'}
          </p>
        </div>

        <div className="border-border/50 rounded-md border p-3">
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            <Flag className="size-3.5" />
            Active flags
          </div>
          {activeFlags.length === 0 ? (
            <p className="text-muted-foreground mt-1 text-sm">None</p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {activeFlags.map((flag) => (
                <li key={flag.name} className="text-foreground text-sm">
                  {flag.name}
                  {flag.content && <span className="text-muted-foreground"> — {flag.content}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="border-border/50 border-t px-4 py-3">
        <p className="text-muted-foreground mb-2 text-xs font-medium">daemon.log tail</p>
        {health.daemonTail.length === 0 ? (
          <p className="text-muted-foreground text-xs">No lines available.</p>
        ) : (
          <pre className="border-border/50 bg-card/50 text-muted-foreground max-h-64 overflow-auto rounded-md border p-2 font-mono text-xs whitespace-pre-wrap">
            {health.daemonTail.join('\n')}
          </pre>
        )}
      </div>
    </div>
  );
};
