import { JSX } from 'react';
interface SettingsSectionHeaderProps {
  readonly title: string;
}

export const SettingsSectionHeader = ({ title }: SettingsSectionHeaderProps): JSX.Element => {
  return (
    <h3 className="text-muted-foreground mt-6 mb-2 text-xs font-medium tracking-widest uppercase first:mt-0">
      {title}
    </h3>
  );
};
