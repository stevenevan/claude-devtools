/**
 * SettingsSectionHeader - Section header component.
 * Linear-style subtle label.
 */

interface SettingsSectionHeaderProps {
  readonly title: string;
}

export const SettingsSectionHeader = ({ title }: SettingsSectionHeaderProps): React.JSX.Element => {
  return (
    <h3 className="text-text-muted mt-6 mb-2 text-xs font-medium tracking-widest uppercase first:mt-0">
      {title}
    </h3>
  );
};
