import { JSX, ReactNode } from 'react';
interface SettingRowProps {
  readonly label: string;
  readonly description?: string;
  readonly anchorId?: string;
  readonly children: ReactNode;
}

export const SettingRow = ({
  label,
  description,
  anchorId,
  children,
}: SettingRowProps): JSX.Element => {
  return (
    <div
      id={anchorId}
      tabIndex={anchorId ? -1 : undefined}
      aria-label={anchorId ? label : undefined}
      className="border-border/50 flex items-center justify-between border-b py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <div>
        <div className="text-foreground text-sm font-medium">{label}</div>
        {description && <div className="text-muted-foreground text-xs">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
};
