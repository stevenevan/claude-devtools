import { JSX } from 'react';
interface SettingsSectionHeaderProps {
  readonly title: string;
  readonly anchorId?: string;
}

export const SettingsSectionHeader = ({
  title,
  anchorId,
}: SettingsSectionHeaderProps): JSX.Element => {
  return (
    <h3
      id={anchorId}
      tabIndex={anchorId ? -1 : undefined}
      aria-label={anchorId ? title : undefined}
      className="text-muted-foreground mt-6 mb-2 text-xs font-medium tracking-widest uppercase first:mt-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {title}
    </h3>
  );
};
