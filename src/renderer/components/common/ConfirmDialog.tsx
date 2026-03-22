/**
 * ConfirmDialog - Reusable themed confirmation dialog.
 *
 * Replaces native window.confirm() with a styled AlertDialog.
 * Controlled via imperative confirm() function.
 */

import { useEffect, useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@renderer/components/ui/alert-dialog';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogState {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
}

type ConfirmResolver = ((confirmed: boolean) => void) | null;

const initialState: ConfirmDialogState = {
  isOpen: false,
  title: '',
  message: '',
};

// Singleton state — one dialog at a time
let globalSetState: ((state: ConfirmDialogState) => void) | null = null;
let globalResolver: ConfirmResolver = null;

/**
 * Imperatively show a themed confirm dialog. Returns a promise that resolves
 * to true (confirmed) or false (cancelled).
 */
// eslint-disable-next-line react-refresh/only-export-components -- imperative API shares singleton state with component
export async function confirm(opts: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
}): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (globalResolver) {
      globalResolver(false);
    }

    globalResolver = resolve;
    globalSetState?.({
      isOpen: true,
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.confirmLabel,
      cancelLabel: opts.cancelLabel,
      variant: opts.variant,
    });
  });
}

/**
 * ConfirmDialog component. Mount once at the app root (e.g. in App.tsx).
 */
export const ConfirmDialog = (): React.JSX.Element => {
  const [state, setState] = useState<ConfirmDialogState>(initialState);

  useEffect(() => {
    globalSetState = setState;
    return () => {
      globalSetState = null;
    };
  }, []);

  const close = (confirmed: boolean): void => {
    if (globalResolver) {
      globalResolver(confirmed);
      globalResolver = null;
    }
    setState(initialState);
  };

  const isDanger = state.variant === 'danger';

  return (
    <AlertDialog
      open={state.isOpen}
      onOpenChange={(open) => { if (!open) close(false); }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          {isDanger && (
            <AlertDialogMedia className="bg-red-500/10">
              <AlertTriangle className="size-5 text-red-400" />
            </AlertDialogMedia>
          )}
          <AlertDialogTitle>{state.title}</AlertDialogTitle>
          <AlertDialogDescription>{state.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>
            {state.cancelLabel ?? 'Cancel'}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={isDanger ? 'destructive' : 'default'}
            onClick={() => close(true)}
          >
            {state.confirmLabel ?? 'Confirm'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
