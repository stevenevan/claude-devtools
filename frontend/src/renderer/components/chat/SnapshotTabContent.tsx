import { JSX, useEffect, useState } from 'react';
import { useStore } from '@renderer/store';
import { Camera } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { Tab } from '@renderer/types/tabs';
import type { SessionDetail } from '@shared/types';

interface Props {
  tab: Tab;
}

export const SnapshotTabContent = ({ tab }: Readonly<Props>): JSX.Element => {
  const { loadSnapshotDetail, snapshots } = useStore(
    useShallow((s) => ({
      loadSnapshotDetail: s.loadSnapshotDetail,
      snapshots: s.snapshots,
    }))
  );

  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const meta = snapshots.find((s) => s.id === tab.snapshotId);

  useEffect(() => {
    if (!tab.snapshotId) return;
    let cancelled = false;
    void loadSnapshotDetail(tab.snapshotId).then((d) => {
      if (cancelled) return;
      if (!d) setError('Failed to load snapshot');
      else setDetail(d);
    });
    return () => {
      cancelled = true;
    };
  }, [tab.snapshotId, loadSnapshotDetail]);

  return (
    <div className="bg-surface flex flex-1 flex-col overflow-auto p-4">
      <div className="border-border bg-surface-raised mb-4 flex items-center gap-2 rounded-md border px-3 py-2 text-xs">
        <Camera className="text-text-secondary size-4" />
        <span className="text-text font-medium">{meta?.label ?? 'Snapshot'}</span>
        <span className="bg-primary/20 text-primary ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium uppercase">
          Read-only
        </span>
      </div>

      {error && <div className="text-destructive text-sm">{error}</div>}

      {!error && detail === null && <div className="text-text-muted text-sm">Loading…</div>}

      {detail && (
        <div className="text-text-secondary flex flex-col gap-3 text-sm">
          <div>
            <span className="text-text-muted">Source session:</span>{' '}
            <span className="font-mono">{detail.session.id}</span>
          </div>
          <div>
            <span className="text-text-muted">Project:</span>{' '}
            <span className="font-mono">{detail.session.projectPath}</span>
          </div>
          <div>
            <span className="text-text-muted">Chunks:</span> {detail.chunks.length}
          </div>
          <div>
            <span className="text-text-muted">Messages:</span> {detail.messages.length}
          </div>
          <div>
            <span className="text-text-muted">Total tokens:</span>{' '}
            {detail.metrics.totalTokens.toLocaleString()}
          </div>
          {detail.metrics.costUsd != null && (
            <div>
              <span className="text-text-muted">Cost:</span> ${detail.metrics.costUsd.toFixed(2)}
            </div>
          )}
          <p className="text-text-muted mt-4 max-w-prose text-xs">
            Snapshots preserve the parsed session payload at the time of capture. Full timeline
            replay in this tab is intentionally minimal — open the original session for navigation
            and search.
          </p>
        </div>
      )}
    </div>
  );
};
