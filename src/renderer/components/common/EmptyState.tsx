import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';

import type { LucideIcon } from 'lucide-react';

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

interface EmptyStateProps {
  Icon: LucideIcon;
  title: string;
  description?: string;
  action?: EmptyStateAction;
  className?: string;
}

export const EmptyState = ({
  Icon,
  title,
  description,
  action,
  className,
}: Readonly<EmptyStateProps>): React.JSX.Element => (
  <div
    className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)}
  >
    <div className="border-border bg-surface-raised mb-3 flex size-12 items-center justify-center rounded-full border">
      <Icon className="text-text-muted size-5" aria-hidden="true" />
    </div>
    <p className="text-text mb-1 text-sm font-medium">{title}</p>
    {description && (
      <p className="text-text-muted max-w-sm text-xs leading-relaxed">{description}</p>
    )}
    {action && (
      <Button variant="secondary" size="sm" onClick={action.onClick} className="mt-3">
        {action.label}
      </Button>
    )}
  </div>
);
