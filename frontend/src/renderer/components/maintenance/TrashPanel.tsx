import { JSX, useEffect, useState } from 'react';
import { isDesktopMode } from '@renderer/api';
import { confirm } from '@renderer/components/common/ConfirmDialog';
import { Button } from '@renderer/components/ui/button';
import { useStore } from '@renderer/store';
import { formatBytes } from '@renderer/utils/formatters';
import { Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { DryRunConfirmDialog } from './DryRunConfirmDialog';

import type { TrashReceipt } from '@shared/types';

function receiptBytes(receipt: TrashReceipt): number {
  return receipt.items.reduce((sum, item) => sum + item.bytes, 0);
}

export const TrashPanel = (): JSX.Element => {
  const {
    receipts,
    trashLoading,
    trashError,
    connectionMode,
    loadTrash,
    restoreTrash,
    emptyTrash,
  } = useStore(
    useShallow((s) => ({
      receipts: s.receipts,
      trashLoading: s.trashLoading,
      trashError: s.trashError,
      connectionMode: s.connectionMode,
      loadTrash: s.loadTrash,
      restoreTrash: s.restoreTrash,
      emptyTrash: s.emptyTrash,
    }))
  );

  const [pendingDelete, setPendingDelete] = useState<TrashReceipt | null>(null);

  const canAct = isDesktopMode() && connectionMode === 'local';

  useEffect(() => {
    void loadTrash();
  }, [loadTrash]);

  const handleRestore = async (receipt: TrashReceipt): Promise<void> => {
    const proceed = await confirm({
      title: 'Restore items',
      message: `Restore ${receipt.items.length} ${receipt.items.length === 1 ? 'item' : 'items'} to their original location?`,
      confirmLabel: 'Restore',
    });
    if (proceed) {
      await restoreTrash(receipt.id);
    }
  };

  const handleConfirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return;
    await emptyTrash([pendingDelete.id]);
    setPendingDelete(null);
  };

  return (
    <div className="flex flex-col">
      <div className="border-border/50 flex items-center justify-between border-b px-4 py-3">
        <span className="text-foreground text-sm font-medium">Trash</span>
        <Button
          variant="outline"
          size="sm"
          disabled={trashLoading}
          onClick={() => void loadTrash()}
        >
          {trashLoading && <Loader2 className="size-3.5 animate-spin" />}
          Refresh
        </Button>
      </div>

      {!canAct && (
        <div className="border-border/50 bg-card/50 text-muted-foreground border-b px-4 py-2 text-xs">
          Trash management operates on this local machine only.
        </div>
      )}

      {trashError && (
        <div className="border-border/50 bg-destructive/10 text-destructive border-b px-4 py-2 text-xs">
          {trashError}
        </div>
      )}

      {receipts.length === 0 ? (
        <div className="text-muted-foreground flex flex-col items-center justify-center py-12 text-sm">
          Trash is empty.
        </div>
      ) : (
        <ul className="divide-border/50 divide-y">
          {receipts.map((receipt) => (
            <li key={receipt.id} className="flex items-center justify-between gap-4 px-4 py-2">
              <div className="min-w-0">
                <p className="text-foreground truncate text-sm">
                  {receipt.trashedAt.toLocaleString()}
                </p>
                <p className="text-muted-foreground text-xs">
                  {receipt.items.length} {receipt.items.length === 1 ? 'item' : 'items'} -{' '}
                  {formatBytes(receiptBytes(receipt))}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canAct || trashLoading}
                  onClick={() => void handleRestore(receipt)}
                >
                  <RotateCcw className="size-3.5" />
                  Restore
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={!canAct || trashLoading}
                  onClick={() => setPendingDelete(receipt)}
                >
                  <Trash2 className="size-3.5" />
                  Delete permanently
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pendingDelete && (
        <DryRunConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null);
          }}
          paths={pendingDelete.items.map((item) => item.origPath)}
          totalBytes={receiptBytes(pendingDelete)}
          fileCount={pendingDelete.items.length}
          busy={trashLoading}
          error={trashError}
          onDeletePermanently={() => void handleConfirmDelete()}
        />
      )}
    </div>
  );
};
