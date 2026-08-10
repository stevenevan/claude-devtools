import { JSX } from 'react';
import { Button } from '@renderer/components/ui/button';

export interface InstallableListItem {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly detail?: string;
  readonly source?: string;
  readonly stateLabel?: string;
  readonly action?: {
    readonly label: string;
    readonly onClick: () => void;
    readonly disabled?: boolean;
    readonly ariaLabel?: string;
  };
}

interface InstallableListProps {
  readonly items: readonly InstallableListItem[];
  readonly emptyMessage: string;
  readonly ariaLabel: string;
}

export const InstallableList = ({
  items,
  emptyMessage,
  ariaLabel,
}: InstallableListProps): JSX.Element => {
  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyMessage}</p>;
  }

  return (
    <ul aria-label={ariaLabel} className="flex flex-col gap-2">
      {items.map((item) => (
        <li
          key={item.id}
          className="border-border bg-card/50 flex items-start justify-between gap-4 rounded-md border px-4 py-3"
        >
          <div className="min-w-0">
            <p className="text-foreground text-sm font-medium">{item.name}</p>
            {item.description && (
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                {item.description}
              </p>
            )}
            {item.detail && <p className="text-muted-foreground mt-1 text-xs">{item.detail}</p>}
            {item.source && (
              <p className="text-muted-foreground mt-2 text-xs">
                From: <span className="text-foreground">{item.source}</span>
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {item.stateLabel && (
              <span className="text-muted-foreground rounded-sm border border-border/60 px-2 py-1 text-xs">
                {item.stateLabel}
              </span>
            )}
            {item.action && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={item.action.disabled}
                aria-label={item.action.ariaLabel ?? `${item.action.label} ${item.name}`}
                onClick={item.action.onClick}
              >
                {item.action.label}
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
};
