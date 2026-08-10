import { JSX, useEffect } from 'react';
import { Button } from '@renderer/components/ui/button';
import { useStore } from '@renderer/store';
import { Camera, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { registerDashboardWidget } from './widgetContract';

import type { SnapshotMeta } from '@shared/types/api';

registerDashboardWidget({
  id: 'snapshots-view',
  title: 'Session Snapshots',
  description: 'Saved session snapshots.',
  category: 'session',
  defaultSize: { cols: 4, rows: 2 },
  minSize: { cols: 2, rows: 1 },
  maxSize: { cols: 6, rows: 4 },
  defaultVisible: true,
});

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString();
}

export const SnapshotsView = (): JSX.Element => {
  const { snapshots, snapshotsLoading, fetchSnapshots, deleteSnapshot, openTab } = useStore(
    useShallow((s) => ({
      snapshots: s.snapshots,
      snapshotsLoading: s.snapshotsLoading,
      fetchSnapshots: s.fetchSnapshots,
      deleteSnapshot: s.deleteSnapshot,
      openTab: s.openTab,
    }))
  );

  useEffect(() => {
    void fetchSnapshots();
  }, [fetchSnapshots]);

  const handleOpen = (meta: SnapshotMeta): void => {
    openTab({
      type: 'snapshot',
      label: `📸 ${meta.label}`,
      snapshotId: meta.id,
    });
  };

  return (
    <div className="bg-surface-raised border-border rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-text-secondary inline-flex items-center gap-2 text-sm font-medium">
          <Camera className="size-4" />
          Session Snapshots
        </h3>
        <span className="text-text-muted text-[11px]">{snapshots.length} saved</span>
      </div>

      {snapshotsLoading && snapshots.length === 0 ? (
        <p className="text-text-muted text-xs">Loading…</p>
      ) : snapshots.length === 0 ? (
        <p className="text-text-muted text-xs">
          No snapshots yet. Save one from a session via the session menu.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {snapshots.map((meta) => (
            <li
              key={meta.id}
              className="border-border bg-surface flex flex-col gap-1 rounded-md border p-3"
            >
              <button
                type="button"
                onClick={() => handleOpen(meta)}
                className="text-text hover:text-primary text-left text-sm font-medium"
              >
                {meta.label}
              </button>
              <div className="text-text-muted flex flex-wrap items-center gap-2 text-[10px]">
                <span>{formatDate(meta.createdAt)}</span>
                <span>·</span>
                <span>{meta.chunkCount} chunks</span>
                <span>·</span>
                <span>{formatBytes(meta.sizeBytes)}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void deleteSnapshot(meta.id)}
                className="text-destructive h-6 w-fit gap-1 px-2 text-[10px]"
              >
                <Trash2 className="size-3" />
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
