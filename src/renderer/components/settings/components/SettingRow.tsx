/**
 * SettingRow - Setting row component for consistent layout.
 * Linear-style clean row without icons.
 */

interface SettingRowProps {
  readonly label: string;
  readonly description?: string;
  readonly children: React.ReactNode;
}

export const SettingRow = ({
  label,
  description,
  children,
}: SettingRowProps): React.JSX.Element => {
  return (
    <div className="border-border-subtle flex items-center justify-between border-b py-3">
      <div>
        <div className="text-text text-sm font-medium">{label}</div>
        {description && <div className="text-text-muted text-xs">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
};
