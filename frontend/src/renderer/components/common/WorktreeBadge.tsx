import { cn } from '@renderer/lib/utils';

import type { WorktreeSource } from '@renderer/types/data';

interface WorktreeBadgeProps {
  source: WorktreeSource;
  isMain?: boolean;
  className?: string;
}

const SOURCE_LABELS: Partial<Record<WorktreeSource, string>> = {
  'vibe-kanban': 'Vibe',
  conductor: 'Conductor',
  'auto-claude': 'Auto',
  '21st': '21st',
  'claude-desktop': 'Desktop',
  ccswitch: 'ccswitch',
};

const BADGE_CLASSES = 'bg-[rgba(161,161,170,0.15)] text-zinc-400';
const DEFAULT_BADGE_CLASSES = 'bg-[rgba(82,82,91,0.3)] text-zinc-500';

export const WorktreeBadge = ({
  source,
  isMain = false,
  className = '',
}: Readonly<WorktreeBadgeProps>): React.ReactElement | null => {
  const baseClasses = cn(
    'inline-flex shrink-0 items-center rounded-sm px-1 py-px text-[9px] font-medium',
    className
  );

  if (isMain) {
    return <span className={cn(baseClasses, DEFAULT_BADGE_CLASSES)}>Default</span>;
  }

  const label = SOURCE_LABELS[source];

  if (!label) {
    return null;
  }

  return (
    <span className={cn(baseClasses, BADGE_CLASSES)} title={`Created by ${label}`}>
      {label}
    </span>
  );
};
