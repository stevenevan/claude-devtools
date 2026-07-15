import { JSX } from 'react';
import { isDesktopMode } from '@renderer/api';
import { confirm } from '@renderer/components/common/ConfirmDialog';
import { Button } from '@renderer/components/ui/button';
import { useStore } from '@renderer/store';
import { formatBytes } from '@renderer/utils/formatters';
import { useShallow } from 'zustand/react/shallow';

import { CategoryCleanupPanel, type CategoryColumn } from './CategoryCleanupPanel';

import type { Candidate } from '@shared/types';

// The active binary lives alongside its backup, named after the backup's family
// group (e.g. "status-line.bin.bak" in a dir whose group is "status-line" →
// active path "<dir>/status-line"). Active files are never candidates, so this
// path has to be derived rather than read off the candidate itself.
function activeBinaryPath(candidate: Candidate): string {
  const dir = candidate.path.slice(0, candidate.path.lastIndexOf('/'));
  return `${dir}/${candidate.group ?? ''}`;
}

export const BackupsCleanupPanel = (): JSX.Element => {
  const { connectionMode, trashLoading, rollbackBinary } = useStore(
    useShallow((s) => ({
      connectionMode: s.connectionMode,
      trashLoading: s.trashLoading,
      rollbackBinary: s.rollbackBinary,
    }))
  );

  const canAct = isDesktopMode() && connectionMode === 'local';

  const handleRollback = async (candidate: Candidate): Promise<void> => {
    const activePath = activeBinaryPath(candidate);
    const proceed = await confirm({
      title: 'Rollback binary',
      message: `Replace ${activePath} with this backup? The current active binary is trashed first, so this can be undone from the Trash tab.`,
      confirmLabel: 'Rollback',
      variant: 'danger',
    });
    if (proceed) {
      await rollbackBinary(activePath, candidate.path);
    }
  };

  const columns: CategoryColumn[] = [
    {
      key: 'name',
      label: 'Backup',
      render: (c) => <span className="text-foreground">{c.path.split('/').pop()}</span>,
    },
    { key: 'bytes', label: 'Size', align: 'right', render: (c) => formatBytes(c.bytes) },
    {
      key: 'status',
      label: 'Status',
      render: (c) => {
        if (c.meta?.identical === 'true') {
          return (
            <span className="rounded-sm bg-zinc-500/15 px-1 py-px text-[9px] font-medium text-zinc-400">
              duplicate
            </span>
          );
        }
        if (c.meta?.identical === 'false') {
          return (
            <span className="rounded-sm bg-sky-500/15 px-1 py-px text-[9px] font-medium text-sky-400">
              rollback point
            </span>
          );
        }
        return null;
      },
    },
    {
      key: 'rollback',
      label: '',
      align: 'right',
      render: (c) => (
        <Button
          variant="ghost"
          size="sm"
          className="text-xs"
          disabled={!canAct || trashLoading}
          onClick={() => void handleRollback(c)}
        >
          Rollback
        </Button>
      ),
    },
  ];

  return (
    <CategoryCleanupPanel
      title="Binary backups"
      description="Backup siblings (*.bak) of the status-line and hook binaries, in the root and hooks/. Active binaries referenced by settings.json are never listed. Duplicate backups are pure waste; distinct ones are real rollback points — Rollback replaces the active binary after trashing a copy of the current one."
      families={[{ id: 'backup-binaries', label: '', supportsCutoff: false }]}
      columns={columns}
      deletePolicy="trash"
    />
  );
};
