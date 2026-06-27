import { JSX, ReactNode } from 'react';
interface SettingRowProps {
  readonly label: string;
  readonly description?: string;
  readonly children: ReactNode;
}

export const SettingRow = ({
  label,
  description,
  children,
}: SettingRowProps): JSX.Element => {
  return (
    <div className="border-border/50 flex items-center justify-between border-b py-3">
      <div>
        <div className="text-foreground text-sm font-medium">{label}</div>
        {description && <div className="text-muted-foreground text-xs">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
};
