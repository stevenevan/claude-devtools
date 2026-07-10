import { JSX, ReactNode, useEffect, useMemo, useState } from 'react';
import { isDesktopMode } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { useStore } from '@renderer/store';
import { formatBytes } from '@renderer/utils/formatters';
import { Loader2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { DryRunConfirmDialog } from './DryRunConfirmDialog';

import type { Candidate } from '@shared/types';

// A trash batch is chunked so a huge junk sweep (thousands of .DS_Store files)
// doesn't hit the trash engine's per-item manifest rewrite as one O(n²) call.
const MAX_BATCH = 500;

export interface CategoryColumn {
  key: string;
  label: string;
  align?: 'right';
  // Renders a cell as plain text/nodes — candidate fields are filesystem-derived,
  // never HTML.
  render: (candidate: Candidate) => ReactNode;
}

export interface CategoryFamily {
  id: string;
  label: string;
  description?: string;
  supportsCutoff?: boolean;
}

interface CategoryCleanupPanelProps {
  title: string;
  description: string;
  families: CategoryFamily[];
  columns: CategoryColumn[];
  deletePolicy?: 'trash' | 'trash+permanent';
  // Maps a Candidate.group key to a display label (e.g. "2026-03" → "March 2026").
  groupLabel?: (group: string) => string;
  // Candidates this returns true for are skipped by group-header "select all" —
  // their own row checkbox still works. E.g. excluding pinned sessions from bulk trash.
  excludeFromBulk?: (candidate: Candidate) => boolean;
}

export const CategoryCleanupPanel = ({
  title,
  description,
  families,
  columns,
  deletePolicy = 'trash',
  groupLabel,
  excludeFromBulk,
}: Readonly<CategoryCleanupPanelProps>): JSX.Element => {
  const {
    connectionMode,
    categoryCandidates,
    categoryScanning,
    categoryError,
    cutoffDays,
    trashLoading,
    trashError,
    scanCategory,
    loadCutoff,
    setCutoff,
    trashItems,
    emptyTrash,
  } = useStore(
    useShallow((s) => ({
      connectionMode: s.connectionMode,
      categoryCandidates: s.categoryCandidates,
      categoryScanning: s.categoryScanning,
      categoryError: s.categoryError,
      cutoffDays: s.cutoffDays,
      trashLoading: s.trashLoading,
      trashError: s.trashError,
      scanCategory: s.scanCategory,
      loadCutoff: s.loadCutoff,
      setCutoff: s.setCutoff,
      trashItems: s.trashItems,
      emptyTrash: s.emptyTrash,
    }))
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  const canAct = isDesktopMode() && connectionMode === 'local';
  const familyIds = families.map((f) => f.id).join(',');

  useEffect(() => {
    if (connectionMode !== 'local') return;
    for (const family of families) {
      if (family.supportsCutoff) void loadCutoff(family.id);
      void scanCategory(family.id);
    }
    setSelected(new Set());
    // families is a stable per-panel config; key on its ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyIds, connectionMode]);

  const allCandidates = useMemo(
    () => families.flatMap((f) => categoryCandidates[f.id] ?? []),
    [families, categoryCandidates]
  );
  const byPath = useMemo(() => {
    const m = new Map<string, Candidate>();
    for (const c of allCandidates) m.set(c.path, c);
    return m;
  }, [allCandidates]);

  const selectedList = [...selected].map((p) => byPath.get(p)).filter((c): c is Candidate => !!c);
  const selectedBytes = selectedList.reduce((sum, c) => sum + c.bytes, 0);
  const selectedFiles = selectedList.reduce((sum, c) => sum + Math.max(1, c.files), 0);

  const toggle = (path: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const toggleMany = (paths: string[], on: boolean): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of paths) {
        if (on) next.add(p);
        else next.delete(p);
      }
      return next;
    });

  const trashSelected = async (): Promise<{ id: string }[]> => {
    const paths = [...selected];
    const receipts: { id: string }[] = [];
    for (let i = 0; i < paths.length; i += MAX_BATCH) {
      const receipt = await trashItems(paths.slice(i, i + MAX_BATCH));
      if (receipt) receipts.push(receipt);
    }
    return receipts;
  };

  const handleMoveToTrash = async (): Promise<void> => {
    await trashSelected();
    finishAction();
  };

  const handleDeletePermanently = async (): Promise<void> => {
    const receipts = await trashSelected();
    if (receipts.length > 0) await emptyTrash(receipts.map((r) => r.id));
    finishAction();
  };

  const finishAction = (): void => {
    setConfirming(false);
    setSelected(new Set());
    for (const family of families) void scanCategory(family.id);
  };

  return (
    <div className="flex flex-col">
      <div className="border-border/50 border-b px-4 py-3">
        <p className="text-foreground text-sm font-medium">{title}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>
      </div>

      {!canAct && (
        <div className="border-border/50 bg-card/50 text-muted-foreground border-b px-4 py-2 text-xs">
          This cleanup operates on this local machine only.
        </div>
      )}
      {categoryError && (
        <div className="border-border/50 bg-destructive/10 text-destructive border-b px-4 py-2 text-xs">
          {categoryError}
        </div>
      )}

      {families.map((family) => (
        <FamilySection
          key={family.id}
          family={family}
          columns={columns}
          candidates={categoryCandidates[family.id] ?? []}
          cutoff={cutoffDays[family.id]}
          scanning={categoryScanning}
          canAct={canAct}
          selected={selected}
          groupLabel={groupLabel}
          excludeFromBulk={excludeFromBulk}
          onToggle={toggle}
          onToggleMany={toggleMany}
          onCutoffChange={(days) => void setCutoff(family.id, days)}
        />
      ))}

      <div className="border-border/50 flex items-center justify-between border-t px-4 py-3">
        <span className="text-muted-foreground text-xs">
          {selected.size} selected - {formatBytes(selectedBytes)}
        </span>
        <Button
          variant="destructive"
          size="sm"
          disabled={!canAct || selected.size === 0 || trashLoading}
          onClick={() => setConfirming(true)}
        >
          {(trashLoading || categoryScanning) && <Loader2 className="size-3.5 animate-spin" />}
          Clean selected
        </Button>
      </div>

      {confirming && (
        <DryRunConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirming(false);
          }}
          paths={[...selected]}
          totalBytes={selectedBytes}
          fileCount={selectedFiles}
          busy={trashLoading}
          error={trashError}
          onMoveToTrash={() => void handleMoveToTrash()}
          onDeletePermanently={
            deletePolicy === 'trash+permanent' ? () => void handleDeletePermanently() : undefined
          }
        />
      )}
    </div>
  );
};

interface FamilySectionProps {
  family: CategoryFamily;
  columns: CategoryColumn[];
  candidates: Candidate[];
  cutoff?: number;
  scanning: boolean;
  canAct: boolean;
  selected: Set<string>;
  groupLabel?: (group: string) => string;
  excludeFromBulk?: (candidate: Candidate) => boolean;
  onToggle: (path: string) => void;
  onToggleMany: (paths: string[], on: boolean) => void;
  onCutoffChange: (days: number) => void;
}

function groupCandidates(candidates: Candidate[]): [string, Candidate[]][] {
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const key = c.group ?? '';
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

const FamilySection = ({
  family,
  columns,
  candidates,
  cutoff,
  scanning,
  canAct,
  selected,
  groupLabel,
  excludeFromBulk,
  onToggle,
  onToggleMany,
  onCutoffChange,
}: Readonly<FamilySectionProps>): JSX.Element => {
  const groups = groupCandidates(candidates);

  return (
    <div className="border-border/50 border-b">
      {(family.description || family.supportsCutoff || family.label) && (
        <div className="flex items-center justify-between px-4 py-2">
          <div className="min-w-0">
            <p className="text-foreground text-xs font-medium">{family.label}</p>
            {family.description && (
              <p className="text-muted-foreground text-xs">{family.description}</p>
            )}
          </div>
          {family.supportsCutoff && (
            <label className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
              Older than
              <input
                type="number"
                min={1}
                max={36500}
                defaultValue={cutoff ?? ''}
                disabled={!canAct}
                onBlur={(e) => {
                  const days = Number(e.target.value);
                  if (Number.isFinite(days) && days >= 1 && days !== cutoff) onCutoffChange(days);
                }}
                className="border-border/50 bg-card/50 text-foreground w-16 rounded-sm border px-1 py-0.5 text-right text-xs"
              />
              days
            </label>
          )}
        </div>
      )}

      {candidates.length === 0 ? (
        <p className="text-muted-foreground px-4 py-3 text-xs">
          {scanning ? 'Scanning…' : 'No candidates.'}
        </p>
      ) : (
        groups.map(([groupKey, groupItems]) => {
          const paths = groupItems.map((c) => c.path);
          const bulkPaths = excludeFromBulk
            ? groupItems.filter((c) => !excludeFromBulk(c)).map((c) => c.path)
            : paths;
          const allOn = bulkPaths.length > 0 && bulkPaths.every((p) => selected.has(p));
          return (
            <div key={groupKey || family.id}>
              {groupKey && (
                <label className="text-muted-foreground bg-card/30 flex items-center gap-2 px-4 py-1 text-xs font-medium">
                  <input
                    type="checkbox"
                    checked={allOn}
                    disabled={!canAct || bulkPaths.length === 0}
                    onChange={(e) => onToggleMany(bulkPaths, e.target.checked)}
                  />
                  {groupLabel ? groupLabel(groupKey) : groupKey}
                  <span className="text-muted-foreground/70">({groupItems.length})</span>
                </label>
              )}
              <table className="w-full border-collapse text-sm">
                <tbody>
                  {groupItems.map((c) => (
                    <tr key={c.path} className="border-border/50 hover:bg-card/50 border-b">
                      <td className="w-6 px-4 py-1.5">
                        <input
                          type="checkbox"
                          checked={selected.has(c.path)}
                          disabled={!canAct}
                          onChange={() => onToggle(c.path)}
                        />
                      </td>
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className={`text-muted-foreground px-2 py-1.5 ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                        >
                          {col.render(c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })
      )}
    </div>
  );
};
