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
import { Loader2 } from 'lucide-react';

import type { HookEntry } from '@shared/types/api';

interface HookArmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: HookEntry | null;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
}

// Mirrors maintenance/DryRunConfirmDialog.tsx: arming a hook repeats the
// exact command verbatim, plain text only, before it is moved back into
// settings.json where the CLI executes it on every matching event.
export const HookArmDialog = ({
  open,
  onOpenChange,
  entry,
  busy = false,
  error = null,
  onConfirm,
}: Readonly<HookArmDialogProps>): JSX.Element => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Enable hook?</DialogTitle>
          <DialogDescription>
            This command runs on every {entry?.event ?? 'matching'} event:
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-48 overflow-y-auto rounded-md border border-border/50 bg-card/50 p-2">
          {entry?.commands.map((command, idx) => (
            <p key={idx} className="text-muted-foreground text-xs break-all whitespace-pre-wrap">
              {command}
            </p>
          ))}
        </div>

        <p className="text-muted-foreground text-xs">
          Enabling arms this command to run automatically on every matching event — it is not
          previewed or sandboxed.
        </p>

        {error && <p className="text-destructive text-xs">{error}</p>}

        <DialogFooter>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="default" size="sm" disabled={busy} onClick={onConfirm}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            Enable hook
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
