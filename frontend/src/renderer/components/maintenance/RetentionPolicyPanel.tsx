import { JSX, useEffect, useState } from 'react';
import { api, isDesktopMode } from '@renderer/api';
import { confirm } from '@renderer/components/common/ConfirmDialog';
import { Button } from '@renderer/components/ui/button';
import { Checkbox } from '@renderer/components/ui/checkbox';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@renderer/components/ui/native-select';
import { useStore } from '@renderer/store';
import {
  getDriftAlertClaudeJson,
  getDriftAlertSettings,
  setDriftAlertClaudeJson,
  setDriftAlertSettings,
} from '@renderer/utils/driftAlertPrefs';
import { formatBytes } from '@renderer/utils/formatters';
import { CalendarClock, ChevronRight, Eye, Loader2, RefreshCw, RotateCcw, Trash2, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { CategoryReport, CombinedReport, RetentionPolicy, ScheduleInterval } from '@shared/types';

// Readable labels for the 15 trash-governed matcher ids + "history". The
// plain-delete ids (logs, logs-daemon, caches) are deliberately absent — they
// are never policy rows.
const CATEGORY_LABELS: Record<string, string> = {
  'backup-binaries': 'Backup binaries',
  'file-history': 'File history',
  'junk-dsstore': 'macOS files (.DS_Store)',
  'junk-tmp': 'Stale temp files (*.tmp)',
  'junk-emptydirs': 'Empty directories',
  plans: 'Plans',
  plugins: 'Plugins',
  projects: 'Projects',
  'runtime-tasks': 'Task state',
  'runtime-tasks-empty': 'Empty task markers',
  'runtime-jobs': 'Jobs',
  'runtime-sessions': 'Sessions',
  'runtime-session-env': 'Session environments',
  'runtime-shell-snapshots': 'Shell snapshots',
  transcripts: 'Transcripts',
  history: 'Command history',
};

const labelFor = (id: string): string => CATEGORY_LABELS[id] ?? id;

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function reportTotals(report: CombinedReport): { count: number; bytes: number } {
  return report.categories.reduce(
    (acc, c) => ({ count: acc.count + c.count, bytes: acc.bytes + c.bytes }),
    { count: 0, bytes: 0 }
  );
}

export const RetentionPolicyPanel = (): JSX.Element => {
  const connectionMode = useStore(useShallow((s) => s.connectionMode));
  const canAct = isDesktopMode() && connectionMode === 'local';

  const [retention, setRetention] = useState<RetentionPolicy | null>(null);
  const [lastCleanupMs, setLastCleanupMs] = useState(0);
  const [cutoffs, setCutoffs] = useState<Record<string, number>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [scanning, setScanning] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<CombinedReport | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [running, setRunning] = useState(false);
  const [driftSettings, setDriftSettings] = useState(getDriftAlertSettings);
  const [driftClaudeJson, setDriftClaudeJson] = useState(getDriftAlertClaudeJson);

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const cfg = await api.config.get();
      const policy = cfg.retention ?? { categories: {}, trashExpiryDays: 30, scheduleInterval: 'off' };
      const ids = Object.keys(policy.categories);
      const entries = await Promise.all(
        ids.map(async (id) => [id, await api.maintenance.getCutoff(id)] as const)
      );
      setRetention(policy);
      setLastCleanupMs(cfg.lastCleanupMs ?? 0);
      setCutoffs(Object.fromEntries(entries));
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistPolicy = async (next: RetentionPolicy): Promise<void> => {
    setRetention(next);
    setBusy(true);
    setError(null);
    try {
      const updated = await api.config.update('retention', next);
      if (updated.retention) setRetention(updated.retention);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = (id: string, enabled: boolean): void => {
    if (!retention) return;
    void persistPolicy({
      ...retention,
      categories: {
        ...retention.categories,
        [id]: { ...retention.categories[id], enabled },
      },
    });
  };

  const handleTrashExpiry = (days: number): void => {
    if (!retention) return;
    void persistPolicy({ ...retention, trashExpiryDays: days });
  };

  const handleScheduleInterval = (scheduleInterval: ScheduleInterval): void => {
    if (!retention) return;
    void persistPolicy({ ...retention, scheduleInterval });
  };

  const handleAutoApprove = (id: string, autoApproved: boolean): void => {
    if (!retention) return;
    void persistPolicy({
      ...retention,
      categories: {
        ...retention.categories,
        [id]: { ...retention.categories[id], autoApproved },
      },
    });
  };

  const handleDriftSettings = (on: boolean): void => {
    setDriftAlertSettings(on);
    setDriftSettings(on);
  };

  const handleDriftClaudeJson = (on: boolean): void => {
    setDriftAlertClaudeJson(on);
    setDriftClaudeJson(on);
  };

  const handleCutoff = (id: string, days: number): void => {
    setCutoffs((prev) => ({ ...prev, [id]: days }));
    setError(null);
    void api.maintenance.setCutoff(id, days).catch((err) => setError(errText(err)));
  };

  const handleScanCount = async (id: string): Promise<void> => {
    setScanning((prev) => new Set(prev).add(id));
    setError(null);
    try {
      const candidates = await api.maintenance.scanCategory(id);
      setCounts((prev) => ({ ...prev, [id]: candidates.length }));
    } catch (err) {
      setError(errText(err));
    } finally {
      setScanning((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handlePreview = async (): Promise<void> => {
    setPreviewing(true);
    setError(null);
    try {
      setReport(await api.maintenance.previewPolicyClean());
    } catch (err) {
      setError(errText(err));
    } finally {
      setPreviewing(false);
    }
  };

  const runClean = async (): Promise<void> => {
    setRunning(true);
    setError(null);
    try {
      await api.maintenance.runPolicyClean();
      const cfg = await api.config.get();
      setLastCleanupMs(cfg.lastCleanupMs ?? 0);
      setReport(await api.maintenance.previewPolicyClean());
    } catch (err) {
      // Surfaces the backend "already running" / SSH-gate rejection, not a crash.
      setError(errText(err));
    } finally {
      setRunning(false);
    }
  };

  const handleCleanNow = async (): Promise<void> => {
    if (!report) return;
    const { count, bytes } = reportTotals(report);
    const proceed = await confirm({
      title: 'Clean now',
      message: `Move ${count} items (${formatBytes(bytes)}) across ${report.categories.length} categories to trash, then expire ${report.trashExpiryCount} old trash receipts? Trashed items stay restorable.`,
      confirmLabel: 'Clean now',
      variant: 'danger',
    });
    if (proceed) await runClean();
  };

  const handleCancel = (): void => {
    void api.maintenance.cancelPolicyClean().catch((err) => setError(errText(err)));
  };

  const sortedIds = retention
    ? Object.keys(retention.categories).sort((a, b) => labelFor(a).localeCompare(labelFor(b)))
    : [];

  return (
    <div className="flex flex-col">
      <div className="border-border/50 flex items-start justify-between gap-2 border-b px-4 py-3">
        <div>
          <p className="text-foreground text-sm font-medium">Retention Policy</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Compose the per-category cleanups into one Clean-now policy. Enabled categories are moved
            to trash (restorable); old trash receipts expire on each pass.
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => void load()}>
          {loading && <Loader2 className="size-3.5 animate-spin" />}
          Refresh
        </Button>
      </div>

      {!canAct && (
        <div className="border-border/50 bg-card/50 text-muted-foreground border-b px-4 py-2 text-xs">
          Retention cleanup operates on this local machine only.
        </div>
      )}
      {error && (
        <div className="border-border/50 bg-destructive/10 text-destructive border-b px-4 py-2 text-xs">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
        <div className="border-border/50 rounded-md border p-3">
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            <RotateCcw className="size-3.5" />
            Last policy run
          </div>
          <p className="text-foreground mt-1 text-sm">
            {lastCleanupMs === 0 ? 'Never' : new Date(lastCleanupMs).toLocaleString()}
          </p>
        </div>
        <div className="border-border/50 rounded-md border p-3">
          <label className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            <Trash2 className="size-3.5" />
            Trash expiry
          </label>
          {retention && (
            <div className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
              Empty trash older than
              <Input
                type="number"
                min={1}
                max={36500}
                defaultValue={retention.trashExpiryDays}
                disabled={!canAct || busy}
                onBlur={(e) => {
                  const days = Number(e.target.value);
                  if (Number.isFinite(days) && days >= 1 && days !== retention.trashExpiryDays) {
                    handleTrashExpiry(days);
                  }
                }}
                className="border-border/50 bg-card/50 text-foreground w-16 rounded-sm border px-1 py-0.5 text-right text-xs"
              />
              days
            </div>
          )}
        </div>
      </div>

      {retention && (
        <div className="border-border/50 border-t px-4 py-3">
          <div className="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-medium">
            <CalendarClock className="size-3.5" />
            Schedule
          </div>
          <label className="text-muted-foreground flex items-center gap-2 text-xs">
            Run this policy automatically
            <NativeSelect
              size="sm"
              value={retention.scheduleInterval ?? 'off'}
              disabled={!canAct || busy}
              onChange={(e) => handleScheduleInterval(e.target.value as ScheduleInterval)}
              className="min-w-20"
            >
              <NativeSelectOption value="off">Off</NativeSelectOption>
              <NativeSelectOption value="weekly">Weekly</NativeSelectOption>
              <NativeSelectOption value="monthly">Monthly</NativeSelectOption>
            </NativeSelect>
          </label>
          <p className="text-muted-foreground mt-2 text-xs">
            Scheduled cleanup runs only while this app is open; a missed schedule runs on next
            launch.
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            Only auto-approved categories run unattended; the rest raise a notification for one-click
            confirm.
          </p>

          <p className="text-muted-foreground mt-3 mb-1 text-xs font-medium">Config-drift alerts</p>
          <Label htmlFor="retention-drift-settings" className="text-muted-foreground text-xs">
            <Checkbox
              id="retention-drift-settings"
              checked={driftSettings}
              disabled={!canAct}
              onCheckedChange={(checked) => handleDriftSettings(checked === true)}
            />
            Alert when settings.json changes outside this app
          </Label>
          <Label htmlFor="retention-drift-claude-json" className="text-muted-foreground mt-1 text-xs">
            <Checkbox
              id="retention-drift-claude-json"
              checked={driftClaudeJson}
              disabled={!canAct}
              onCheckedChange={(checked) => handleDriftClaudeJson(checked === true)}
            />
            Alert when ~/.claude.json changes outside this app
          </Label>
        </div>
      )}

      {loading ? (
        <p className="text-muted-foreground px-4 py-3 text-xs">Loading policy…</p>
      ) : (
        <div className="divide-border/50 divide-y">
          {sortedIds.map((id) => (
            <CategoryRow
              key={id}
              id={id}
              enabled={retention?.categories[id]?.enabled ?? false}
              autoApproved={retention?.categories[id]?.autoApproved ?? false}
              cutoff={cutoffs[id]}
              count={counts[id]}
              scanning={scanning.has(id)}
              canAct={canAct}
              busy={busy}
              onToggle={(enabled) => handleToggle(id, enabled)}
              onAutoApprove={(autoApproved) => handleAutoApprove(id, autoApproved)}
              onCutoff={(days) => handleCutoff(id, days)}
              onScan={() => void handleScanCount(id)}
            />
          ))}
        </div>
      )}

      <div className="border-border/50 text-muted-foreground border-t px-4 py-2 text-xs">
        Logs and Caches are deleted permanently (not trashed) — manage them on their own Logs and
        Caches tabs. They are excluded from this policy by design.
      </div>

      <div className="border-border/50 flex items-center gap-2 border-t px-4 py-3">
        <Button variant="outline" size="sm" disabled={previewing || running} onClick={() => void handlePreview()}>
          {previewing ? <Loader2 className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />}
          Preview
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={!canAct || !report || running || busy}
          onClick={() => void handleCleanNow()}
        >
          {running ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
          Clean now
        </Button>
        {running && (
          <Button variant="ghost" size="sm" onClick={handleCancel}>
            <X className="size-3.5" />
            Cancel
          </Button>
        )}
        {running && <span className="text-muted-foreground text-xs">Cleaning…</span>}
      </div>

      {report && <ReportView report={report} />}
    </div>
  );
};

interface CategoryRowProps {
  id: string;
  enabled: boolean;
  autoApproved: boolean;
  cutoff?: number;
  count?: number;
  scanning: boolean;
  canAct: boolean;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onAutoApprove: (autoApproved: boolean) => void;
  onCutoff: (days: number) => void;
  onScan: () => void;
}

const CategoryRow = ({
  id,
  enabled,
  autoApproved,
  cutoff,
  count,
  scanning,
  canAct,
  busy,
  onToggle,
  onAutoApprove,
  onCutoff,
  onScan,
}: Readonly<CategoryRowProps>): JSX.Element => (
  <div className="hover:bg-card/50 flex items-center justify-between gap-3 px-4 py-2">
    <Label htmlFor={`retention-category-${id}`} className="flex min-w-0 items-center gap-2 text-sm">
      <Checkbox
        id={`retention-category-${id}`}
        checked={enabled}
        disabled={!canAct || busy}
        onCheckedChange={(checked) => onToggle(checked === true)}
      />
      <span className="text-foreground truncate">{labelFor(id)}</span>
    </Label>

    <div className="flex shrink-0 items-center gap-3">
      <Label
        htmlFor={`retention-auto-approve-${id}`}
        className="text-muted-foreground flex items-center gap-1 text-xs"
        title="Run this category unattended on the schedule (only when enabled)."
      >
        <Checkbox
          id={`retention-auto-approve-${id}`}
          checked={autoApproved}
          disabled={!canAct || busy || !enabled}
          onCheckedChange={(checked) => onAutoApprove(checked === true)}
        />
        Auto-approve
      </Label>

      <label className="text-muted-foreground flex items-center gap-1 text-xs">
        Older than
        <Input
          type="number"
          min={1}
          max={36500}
          defaultValue={cutoff ?? ''}
          disabled={!canAct}
          onBlur={(e) => {
            const days = Number(e.target.value);
            if (Number.isFinite(days) && days >= 1 && days !== cutoff) onCutoff(days);
          }}
          className="border-border/50 bg-card/50 text-foreground w-16 rounded-sm border px-1 py-0.5 text-right text-xs"
        />
        days
      </label>

      <span className="text-muted-foreground w-24 text-right text-xs">
        {count === undefined ? '—' : `${count} candidate${count === 1 ? '' : 's'}`}
      </span>
      <Button variant="ghost" size="sm" disabled={scanning} onClick={onScan}>
        {scanning ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <RefreshCw className="size-3.5" />
        )}
      </Button>
    </div>
  </div>
);

const ReportView = ({ report }: Readonly<{ report: CombinedReport }>): JSX.Element => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { count, bytes } = reportTotals(report);

  const toggle = (id: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="border-border/50 border-t px-4 py-3">
      <p className="text-foreground mb-2 text-xs font-medium">
        Dry-run report — {count} items · {formatBytes(bytes)}
      </p>
      {report.categories.length === 0 ? (
        <p className="text-muted-foreground text-xs">No candidates in any enabled category.</p>
      ) : (
        <ul className="divide-border/50 divide-y">
          {report.categories.map((cat) => (
            <ReportRow
              key={cat.id}
              cat={cat}
              open={expanded.has(cat.id)}
              onToggle={() => toggle(cat.id)}
            />
          ))}
        </ul>
      )}
      <p className="text-muted-foreground mt-2 text-xs">
        Trash expiry: {report.trashExpiryCount} receipt
        {report.trashExpiryCount === 1 ? '' : 's'} past the expiry window.
      </p>
    </div>
  );
};

interface ReportRowProps {
  cat: CategoryReport;
  open: boolean;
  onToggle: () => void;
}

const ReportRow = ({ cat, open, onToggle }: Readonly<ReportRowProps>): JSX.Element => (
  <li className="py-1.5">
    <Button
      variant="ghost"
      size="sm"
      disabled={cat.paths.length === 0}
      onClick={onToggle}
      className="h-auto w-full justify-between gap-2 px-0 text-left"
    >
      <span className="text-foreground flex items-center gap-1">
        <ChevronRight className={`size-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
        {labelFor(cat.id)}
      </span>
      <span className="text-muted-foreground">
        {cat.count} · {formatBytes(cat.bytes)}
      </span>
    </Button>
    {open && cat.paths.length > 0 && (
      <div className="border-border/50 bg-card/50 mt-1 max-h-48 overflow-y-auto rounded-md border p-2">
        {cat.paths.map((path) => (
          <p key={path} className="text-muted-foreground truncate text-xs">
            {path}
          </p>
        ))}
      </div>
    )}
  </li>
);
