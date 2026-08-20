import { JSX, useEffect, useMemo, useState } from 'react';
import { api, isDesktopMode } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { Progress } from '@renderer/components/ui/progress';
import { useStore } from '@renderer/store';
import { formatBytes } from '@renderer/utils/formatters';
import { Loader2, Sparkles } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { DryRunConfirmDialog } from './DryRunConfirmDialog';

import type { DirUsage, SimpleStorageSummary, SourceKind, UsageSummary } from '@shared/types';

export const SIMPLE_CLEANUP_ALLOWLIST = [
  'file-history',
  'junk-dsstore',
  'junk-tmp',
  'junk-emptydirs',
  'runtime-tasks-empty',
  'runtime-jobs',
] as const;

export interface SpaceBucket {
  id: 'old-file-versions' | 'logs-and-caches' | 'everything-else';
  label: string;
  bytes: number;
  files: number;
}

export type SpaceSummaryData = SimpleStorageSummary;

export function shouldRunSimpleCleanup(isLocal: boolean, source: SourceKind): boolean {
  return isLocal && source === 'claude';
}

const BUCKETS: readonly Pick<SpaceBucket, 'id' | 'label'>[] = [
  { id: 'old-file-versions', label: 'Old file versions' },
  { id: 'logs-and-caches', label: 'Logs and caches' },
  { id: 'everything-else', label: 'Everything else' },
];

function leafName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? '';
}

function bucketFor(path: string): SpaceBucket['id'] {
  switch (leafName(path)) {
    case 'file-history':
      return 'old-file-versions';
    case 'logs':
    case 'logs-daemon':
    case 'caches':
      return 'logs-and-caches';
    default:
      return 'everything-else';
  }
}

export function summarizeSpace(dirs: readonly DirUsage[]): SpaceSummaryData {
  const totals = new Map<SpaceBucket['id'], { bytes: number; files: number }>(
    BUCKETS.map(({ id }) => [id, { bytes: 0, files: 0 }])
  );
  for (const dir of dirs) {
    const total = totals.get(bucketFor(dir.path));
    if (!total) continue;
    total.bytes += Math.max(0, dir.bytes);
    total.files += Math.max(0, dir.files);
  }

  return {
    totalBytes: dirs.reduce((sum, dir) => sum + Math.max(0, dir.bytes), 0),
    totalFiles: dirs.reduce((sum, dir) => sum + Math.max(0, dir.files), 0),
    buckets: BUCKETS.map(({ id, label }) => ({
      id,
      label,
      ...totals.get(id)!,
    })),
  };
}

interface SpaceSummaryProps {
  dirs: DirUsage[];
  source: SourceKind;
  onShowAllTools: () => void;
}

export const SpaceSummary = ({
  dirs,
  source,
  onShowAllTools,
}: Readonly<SpaceSummaryProps>): JSX.Element => {
  const {
    connectionMode,
    scanning,
    storageError,
    simpleStorageSummary,
    simpleCleanupPreview,
    simpleCleanupScanning,
    simpleCleanupRunning,
    simpleCleanupError,
    scanStorage,
    previewSimpleCleanup,
    runSimpleCleanup,
  } = useStore(
    useShallow((state) => ({
      connectionMode: state.connectionMode,
      scanning: state.scanning,
      storageError: state.error,
      simpleStorageSummary: state.simpleStorageSummary,
      simpleCleanupPreview: state.simpleCleanupPreview,
      simpleCleanupScanning: state.simpleCleanupScanning,
      simpleCleanupRunning: state.simpleCleanupRunning,
      simpleCleanupError: state.simpleCleanupError,
      scanStorage: state.scanStorage,
      previewSimpleCleanup: state.previewSimpleCleanup,
      runSimpleCleanup: state.runSimpleCleanup,
    }))
  );
  const [confirming, setConfirming] = useState(false);
  const [dialogSummary, setDialogSummary] = useState<typeof simpleCleanupPreview>(null);
  const isLocal = connectionMode === 'local';
  const isSimpleCleanupEnabled = shouldRunSimpleCleanup(isLocal, source);
  const scannedData = useMemo(() => summarizeSpace(dirs), [dirs]);
  const data = simpleStorageSummary ?? scannedData;
  const busy = scanning || simpleCleanupScanning || simpleCleanupRunning;
  const displayError = simpleCleanupError ?? storageError;

  useEffect(() => {
    if (!isSimpleCleanupEnabled) return;
    void scanStorage();
    void previewSimpleCleanup();
  }, [isSimpleCleanupEnabled, previewSimpleCleanup, scanStorage]);

  const openConfirm = (): void => {
    if (!simpleCleanupPreview || simpleCleanupPreview.totalCandidates === 0) return;
    setDialogSummary(simpleCleanupPreview);
    setConfirming(true);
  };

  const handleMoveToTrash = async (): Promise<void> => {
    await runSimpleCleanup();
    setConfirming(false);
    setDialogSummary(null);
  };

  if (!isLocal) {
    return (
      <div className="text-muted-foreground flex flex-col items-center justify-center gap-3 px-4 py-16 text-sm">
        <p>Storage maintenance operates on this local machine only.</p>
        <Button variant="outline" size="sm" onClick={onShowAllTools}>
          Show all maintenance tools
        </Button>
      </div>
    );
  }

  if (source === 'codex') {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6">
        <SourceSummary source={source} />
        <section className="border-border/50 bg-card/30 rounded-lg border p-5">
          <p className="text-foreground text-sm font-medium">Codex maintenance</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Simple storage cleanup is available for Claude Code only. Codex data is read-only in
            this view.
          </p>
          <Button className="mt-4" variant="outline" size="sm" onClick={onShowAllTools}>
            Show all maintenance tools
          </Button>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6">
      <section className="border-border/50 bg-card/30 rounded-lg border p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Local storage
            </p>
            <p className="text-foreground mt-1 text-3xl font-semibold">{formatBytes(data.totalBytes)}</p>
            <p className="text-muted-foreground mt-1 text-xs">
              {data.totalFiles.toLocaleString()} files across the Claude workspace
            </p>
          </div>
          <Sparkles className="text-muted-foreground size-5" aria-hidden="true" />
        </div>

        <p className="text-muted-foreground mt-4 text-xs">
          Review a small, restorable set of old local files. Conversations, projects, plugins,
          logs, and caches stay untouched.
        </p>

        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          {data.buckets.map((bucket) => (
            <div key={bucket.id} className="border-border/50 rounded-md border p-3">
              <p className="text-muted-foreground text-xs">{bucket.label}</p>
              <p className="text-foreground mt-1 text-sm font-medium">{formatBytes(bucket.bytes)}</p>
              <p className="text-muted-foreground mt-0.5 text-[11px]">
                {bucket.files.toLocaleString()} files
              </p>
            </div>
          ))}
        </div>
      </section>

      <SourceSummary source={source} />

      {(scanning || simpleCleanupScanning || simpleCleanupRunning) && (
        <div className="border-border/50 bg-card/30 rounded-lg border p-4" aria-live="polite">
          <div className="flex items-center gap-2">
            <Loader2 className="text-muted-foreground size-3.5 animate-spin" />
            <p className="text-muted-foreground text-xs">
              {simpleCleanupRunning ? 'Clearing old files…' : 'Checking local storage…'}
            </p>
          </div>
          <Progress className="mt-3" value={null} aria-label="Maintenance progress" />
        </div>
      )}

      {displayError && (
        <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-3 text-xs" role="alert">
          {displayError}
        </div>
      )}

      {!busy && dirs.length === 0 && !displayError && (
        <div className="border-border/50 text-muted-foreground rounded-lg border p-5 text-center text-sm">
          No storage results yet.
        </div>
      )}

      {!busy && dirs.length > 0 && simpleCleanupPreview?.totalCandidates === 0 && !displayError && (
        <div className="border-border/50 text-muted-foreground rounded-lg border p-5 text-center text-sm">
          No old files are ready to clear.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="default"
          size="sm"
          disabled={!isDesktopMode() || busy || !simpleCleanupPreview || simpleCleanupPreview.totalCandidates === 0}
          onClick={openConfirm}
        >
          Clear old files
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={onShowAllTools}>
          Show all maintenance tools
        </Button>
      </div>

      {dialogSummary && (
        <DryRunConfirmDialog
          open={confirming}
          onOpenChange={(open) => {
            setConfirming(open);
            if (!open) setDialogSummary(null);
          }}
          summary={{
            totalCandidates: dialogSummary.totalCandidates,
            totalBytes: dialogSummary.totalBytes,
            categories: dialogSummary.categories,
          }}
          busy={simpleCleanupRunning}
          error={simpleCleanupError}
          title="Clear old files?"
          consequence="Moved to the app's trash, not erased — restore anytime from Maintenance > Trash."
          onMoveToTrash={() => void handleMoveToTrash()}
        />
      )}
    </div>
  );
};

const SourceSummary = ({ source }: Readonly<{ source: SourceKind }>): JSX.Element => {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const root = source === 'codex' ? '~/.codex' : '~/.claude';

  useEffect(() => {
    let active = true;
    setUsage(null);
    setError(null);
    void api
      .readSourceUsageSummary(source)
      .then((result) => {
        if (active) setUsage(result);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
    };
  }, [source]);

  return (
    <section className="border-border/50 bg-card/30 rounded-lg border p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-foreground text-sm font-medium">{source === 'codex' ? 'Codex' : 'Claude'} activity</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Read-only summary from {root}. Detailed telemetry and maintenance readers are in the
            Inspect tools.
          </p>
        </div>
        {usage && <span className="text-muted-foreground text-[11px]">{usage.state}</span>}
      </div>
      {error && (
        <p role="alert" className="text-destructive mt-3 text-xs">
          {error}
        </p>
      )}
      {!error && !usage && (
        <p role="status" className="text-muted-foreground mt-3 text-xs">
          Loading activity summary…
        </p>
      )}
      {usage && (
        <>
          <dl className="mt-4 grid gap-x-4 gap-y-3 text-xs sm:grid-cols-4">
            <SummaryMetric label="Period" value={usage.period ?? 'Not reported'} />
            <SummaryMetric label="Turns" value={formatSummaryNumber(usage.turns)} />
            <SummaryMetric label="Tokens" value={formatSummaryNumber(usage.tokens)} />
            <SummaryMetric label="Cost" value={usage.cost === null ? 'Not reported' : String(usage.cost)} />
          </dl>
          <div className="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            {usage.sourceFile && (
              <span className="max-w-full break-all select-text">Provenance: {usage.sourceFile}</span>
            )}
            {usage.revision && <span>Revision: {usage.revision}</span>}
            {usage.stale && <span className="text-warning">Stale snapshot</span>}
          </div>
          {usage.diagnostics.length > 0 && (
            <p role="status" className="text-muted-foreground mt-3 text-xs">
              {usage.diagnostics.map((diagnostic) => diagnostic.message).join(' ')}
            </p>
          )}
        </>
      )}
    </section>
  );
};

const SummaryMetric = ({ label, value }: Readonly<{ label: string; value: string }>): JSX.Element => (
  <div>
    <dt className="text-muted-foreground text-[10px] tracking-wide uppercase">{label}</dt>
    <dd className="text-foreground mt-1 font-medium">{value}</dd>
  </div>
);

const formatSummaryNumber = (value: number | null): string =>
  value === null ? 'Not reported' : value.toLocaleString();
