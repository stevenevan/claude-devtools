import { JSX } from 'react';
import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { formatBytes } from '@renderer/utils/formatters';
import { Loader2 } from 'lucide-react';

interface DryRunConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paths: string[];
  totalBytes: number;
  fileCount: number;
  busy?: boolean;
  error?: string | null;
  // Omit to hide the "Move to trash" action (e.g. items already in trash).
  onMoveToTrash?: () => void;
  // Always shown when provided; the only action offered for already-trashed items.
  onDeletePermanently?: () => void;
}

// Reusable dry-run confirm dialog: every consumer week that surfaces its own
// candidates routes the actual delete back through this dialog + the bound
// MaintenanceService.TrashItems call. Paths render as plain text, never HTML.
export const DryRunConfirmDialog = ({
  open,
  onOpenChange,
  paths,
  totalBytes,
  fileCount,
  busy = false,
  error = null,
  onMoveToTrash,
  onDeletePermanently,
}: Readonly<DryRunConfirmDialogProps>): JSX.Element => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm</DialogTitle>
          <DialogDescription>
            {fileCount} {fileCount === 1 ? 'item' : 'items'} - {formatBytes(totalBytes)}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-48 overflow-y-auto rounded-md border border-border/50 bg-card/50 p-2">
          {paths.map((path) => (
            <p key={path} className="truncate text-xs text-muted-foreground">
              {path}
            </p>
          ))}
        </div>

        {onMoveToTrash && (
          <p className="text-xs text-muted-foreground">
            Moved to the app&apos;s trash, not erased — restore anytime from Maintenance &gt;
            Trash.
          </p>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {onDeletePermanently && (
            <Button variant="destructive" size="sm" disabled={busy} onClick={onDeletePermanently}>
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              Delete permanently{onMoveToTrash ? ' (skip trash)' : ''}
            </Button>
          )}
          {onMoveToTrash && (
            <Button variant="default" size="sm" disabled={busy} onClick={onMoveToTrash}>
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              Move to trash
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
