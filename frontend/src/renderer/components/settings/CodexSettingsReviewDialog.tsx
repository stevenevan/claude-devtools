import { JSX } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';

import type { CodexSettingsPreview } from '@shared/types/api';

interface CodexSettingsReviewDialogProps {
  readonly open: boolean;
  readonly preview: CodexSettingsPreview;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onApply: () => Promise<void>;
}

const FIELD_LABELS: Record<string, string> = {
  model: 'Model',
  approval_policy: 'Approval mode',
  sandbox_mode: 'Sandbox',
};

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

export const CodexSettingsReviewDialog = ({
  open,
  preview,
  busy,
  error,
  onOpenChange,
  onApply,
}: Readonly<CodexSettingsReviewDialogProps>): JSX.Element => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Review Codex settings changes</DialogTitle>
        <DialogDescription>
          Review the safe user-config changes below. Nothing is written until you press Apply.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <div className="border-border/50 bg-card/50 rounded-md border px-3 py-2">
          <div className="text-muted-foreground">Target</div>
          <div className="mt-1 font-medium">{preview.target}</div>
        </div>

        <div className="overflow-x-auto rounded-md border border-border/50">
          <table className="w-full text-left" aria-label="Codex settings changes">
            <thead className="text-muted-foreground border-border/50 border-b">
              <tr>
                <th scope="col" className="px-2 py-1.5 font-medium">Setting</th>
                <th scope="col" className="px-2 py-1.5 font-medium">Current</th>
                <th scope="col" className="px-2 py-1.5 font-medium">New</th>
              </tr>
            </thead>
            <tbody>
              {preview.diff.map((change) => (
                <tr key={change.key} className="border-border/40 border-t align-top">
                  <th scope="row" className="px-2 py-2 font-medium">{fieldLabel(change.key)}</th>
                  <td className="max-w-32 break-words px-2 py-2">{change.oldValue}</td>
                  <td className="max-w-32 break-words px-2 py-2">{change.newValue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {preview.warnings.length > 0 && (
          <div className="border-amber-500/40 bg-amber-500/10 text-amber-500 flex gap-2 rounded-md border px-3 py-2" role="status">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <ul className="space-y-1">
              {preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </div>
        )}

        <p className="text-muted-foreground">
          A private pre-write snapshot is created automatically when the existing user config is present.
        </p>
      </div>

      {error && <p className="text-destructive" role="alert">{error}</p>}

      <DialogFooter>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          variant="default"
          size="sm"
          disabled={busy || !preview.canApply || preview.diff.length === 0}
          onClick={() => void onApply()}
        >
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          Apply to user config
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
