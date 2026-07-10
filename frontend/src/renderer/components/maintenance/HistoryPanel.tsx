import { JSX, useEffect, useState } from 'react';
import { isDesktopMode } from '@renderer/api';
import { confirm } from '@renderer/components/common/ConfirmDialog';
import { Button } from '@renderer/components/ui/button';
import { useStore } from '@renderer/store';
import { formatBytes } from '@renderer/utils/formatters';
import { Loader2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { monthLabel } from './TranscriptsCleanupPanel';

const DEFAULT_CUTOFF_DAYS = 180;

export const HistoryPanel = (): JSX.Element => {
  const { connectionMode, historyStats, trashLoading, trashError, analyzeHistory, pruneHistory } =
    useStore(
      useShallow((s) => ({
        connectionMode: s.connectionMode,
        historyStats: s.historyStats,
        trashLoading: s.trashLoading,
        trashError: s.trashError,
        analyzeHistory: s.analyzeHistory,
        pruneHistory: s.pruneHistory,
      }))
    );

  const [days, setDays] = useState(DEFAULT_CUTOFF_DAYS);

  const canAct = isDesktopMode() && connectionMode === 'local';

  useEffect(() => {
    if (connectionMode !== 'local') return;
    void analyzeHistory();
    // analyzeHistory is a stable store action; only re-run when local mode is (re)entered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionMode]);

  const handlePrune = async (): Promise<void> => {
    const proceed = await confirm({
      title: 'Prune prompt history',
      message: `Prune entries older than ${days} days from history.jsonl? The pruned tail is preserved in the trash in analyzable form, but exact-byte restore isn't possible once the CLI appends further entries.`,
      confirmLabel: 'Prune',
      variant: 'danger',
    });
    if (proceed) {
      await pruneHistory(days);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="border-border/50 border-b px-4 py-3">
        <p className="text-foreground text-sm font-medium">Prompt history</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          history.jsonl backs the CLI's prompt-history recall and grows forever. Pruning removes
          entries older than the cutoff, keeping the pruned tail in the trash in analyzable form.
        </p>
      </div>

      {!canAct && (
        <div className="border-border/50 bg-card/50 text-muted-foreground border-b px-4 py-2 text-xs">
          This cleanup operates on this local machine only.
        </div>
      )}
      {trashError && (
        <div className="border-border/50 bg-destructive/10 text-destructive border-b px-4 py-2 text-xs">
          {trashError}
        </div>
      )}

      <div className="flex items-center justify-between px-4 py-2">
        <label className="text-muted-foreground flex items-center gap-1 text-xs">
          Older than
          <input
            type="number"
            min={1}
            max={36500}
            value={days}
            disabled={!canAct}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (Number.isFinite(value) && value >= 1) setDays(value);
            }}
            className="border-border/50 bg-card/50 text-foreground w-16 rounded-sm border px-1 py-0.5 text-right text-xs"
          />
          days
        </label>
      </div>

      {!historyStats || historyStats.months.length === 0 ? (
        <p className="text-muted-foreground px-4 py-3 text-xs">
          {trashLoading ? 'Analyzing…' : 'No history.jsonl entries found.'}
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <tbody>
            {historyStats.months.map((m) => (
              <tr key={m.month} className="border-border/50 hover:bg-card/50 border-b">
                <td className="text-foreground px-4 py-1.5">{monthLabel(m.month)}</td>
                <td className="text-muted-foreground px-2 py-1.5 text-right">
                  {m.lines.toLocaleString()} lines
                </td>
                <td className="text-muted-foreground px-2 py-1.5 text-right">
                  {formatBytes(m.bytes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {historyStats && historyStats.malformed > 0 && (
        <p className="text-muted-foreground px-4 py-2 text-xs">
          {historyStats.malformed.toLocaleString()}{' '}
          {historyStats.malformed === 1 ? 'line' : 'lines'} skipped as malformed.
        </p>
      )}

      <div className="border-border/50 flex items-center justify-between border-t px-4 py-3">
        <span className="text-muted-foreground text-xs">
          {historyStats
            ? `Prune ${historyStats.prunableLines.toLocaleString()} lines (~${formatBytes(historyStats.prunableBytes)}) older than ${days} days`
            : ''}
        </span>
        <Button
          variant="destructive"
          size="sm"
          disabled={!canAct || trashLoading || !historyStats || historyStats.prunableLines === 0}
          onClick={() => void handlePrune()}
        >
          {trashLoading && <Loader2 className="size-3.5 animate-spin" />}
          Prune
        </Button>
      </div>
    </div>
  );
};
