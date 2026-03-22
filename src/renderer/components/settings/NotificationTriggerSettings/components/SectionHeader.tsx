/**
 * Section header component - Linear style.
 */

interface SectionHeaderProps {
  title: string;
}

export const SectionHeader = ({ title }: Readonly<SectionHeaderProps>): React.JSX.Element => {
  return (
    <h3 className="text-muted-foreground mt-6 mb-2 text-xs font-medium tracking-widest uppercase first:mt-0">
      {title}
    </h3>
  );
};
