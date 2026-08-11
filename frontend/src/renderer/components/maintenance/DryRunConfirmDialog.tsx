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

export interface DryRunSummaryCategory {
  id: string;
  label: string;
  candidates: number;
  bytes: number;
}

export interface DryRunSummary {
  totalCandidates: number;
  totalBytes: number;
  categories: DryRunSummaryCategory[];
}

interface DryRunConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paths?: string[];
  totalBytes?: number;
  fileCount?: number;
  // Summary mode intentionally has no path input. It is used by Simple mode,
  // where the backend token owns the candidate set.
  summary?: DryRunSummary;
  busy?: boolean;
  error?: string | null;
  // Omit to hide the "Move to trash" action (e.g. items already in trash).
  onMoveToTrash?: () => void;
  // Always shown when provided; the only action offered for already-trashed items.
  onDeletePermanently?: () => void;
  // Plain-delete policy: irreversible, no trash copy. Mutually exclusive with
  // onMoveToTrash/onDeletePermanently — callers pass only one action.
  onClear?: () => void;
  // Swaps the trash-copy reassurance copy for the plain-delete warning.
  plain?: boolean;
  // Optional copy for callers whose action has a more specific consequence.
  title?: string;
  consequence?: string;
  actionLabel?: string;
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
  onClear,
  plain = false,
  title = 'Confirm',
  consequence,
  actionLabel = 'Move to trash',
  summary,
}: Readonly<DryRunConfirmDialogProps>): JSX.Element => {
  const displayBytes = summary?.totalBytes ?? totalBytes ?? 0;
  const displayCount = summary?.totalCandidates ?? fileCount ?? paths?.length ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {displayCount} {displayCount === 1 ? 'item' : 'items'} - {formatBytes(displayBytes)}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-48 overflow-y-auto rounded-md border border-border/50 bg-card/50 p-2">
          {summary
            ? summary.categories.map((category) => (
                <div key={category.id} className="flex items-center justify-between gap-3 py-1">
                  <span className="text-xs text-muted-foreground">{category.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {category.candidates.toLocaleString()} - {formatBytes(category.bytes)}
                  </span>
                </div>
              ))
            : (paths ?? []).map((path) => (
                <p key={path} className="truncate text-xs text-muted-foreground">
                  {path}
                </p>
              ))}
        </div>

        {onMoveToTrash && (
          <p className="text-xs text-muted-foreground">
            {consequence ??
              "Moved to the app's trash, not erased — restore anytime from Maintenance > Trash."}
          </p>
        )}
        {plain && (
          <p className="text-xs text-muted-foreground">
            Deleted immediately — not moved to trash.
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
              {actionLabel}
            </Button>
          )}
          {onClear && (
            <Button variant="destructive" size="sm" disabled={busy} onClick={onClear}>
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              Delete immediately
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
