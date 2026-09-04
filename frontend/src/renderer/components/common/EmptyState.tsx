import { JSX } from 'react';

import { Button } from '@renderer/components/ui/button';
import { useUIMode } from '@renderer/hooks/useUIMode';
import { Inbox } from 'lucide-react';

import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const EmptyState = ({
  icon: Icon = Inbox,
  title,
  hint,
  detail,
  actionLabel,
  onAction,
}: Readonly<EmptyStateProps>): JSX.Element => {
  const mode = useUIMode();

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <Icon aria-hidden="true" className="text-muted-foreground mb-3 size-10 opacity-30" />
      <p className="text-foreground text-sm font-medium">{title}</p>
      {hint ? <p className="text-muted-foreground mt-1 text-xs">{hint}</p> : null}
      {mode === 'nerd' && detail ? (
        <p className="text-muted-foreground mt-1 max-w-md text-xs break-words">{detail}</p>
      ) : null}
      {actionLabel && onAction ? (
        <Button type="button" variant="ghost" size="sm" onClick={onAction} className="mt-3">
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
};
