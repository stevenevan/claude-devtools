/**
 * WorktreeBadge - Displays a compact badge indicating the worktree source.
 * Shows subtle, muted colors for each worktree type.
 */

import { cn } from '@renderer/lib/utils';

import type { WorktreeSource } from '@renderer/types/data';

interface WorktreeBadgeProps {
  source: WorktreeSource;
  /** Whether this is the main worktree */
  isMain?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/** Label per worktree source type */
const SOURCE_LABELS: Partial<Record<WorktreeSource, string>> = {
  'vibe-kanban': 'Vibe',
  conductor: 'Conductor',
  'auto-claude': 'Auto',
  '21st': '21st',
  'claude-desktop': 'Desktop',
  ccswitch: 'ccswitch',
};

/** Shared Tailwind classes for all source badges (zinc-400 tone) */
const BADGE_CLASSES = 'bg-[rgba(161,161,170,0.15)] text-zinc-400';

/** Classes for the default/main worktree badge (zinc-600/30 bg, zinc-500 text) */
const DEFAULT_BADGE_CLASSES = 'bg-[rgba(82,82,91,0.3)] text-zinc-500';

export const WorktreeBadge = ({
  source,
  isMain = false,
  className = '',
}: Readonly<WorktreeBadgeProps>): React.ReactElement | null => {
  const baseClasses = cn('inline-flex shrink-0 items-center rounded-sm px-1 py-px text-[9px] font-medium', className);

  // Show Default badge if isMain is true (the default/primary worktree)
  if (isMain) {
    return <span className={cn(baseClasses, DEFAULT_BADGE_CLASSES)}>Default</span>;
  }

  const label = SOURCE_LABELS[source];

  // Don't render badge for standard git or unknown sources
  if (!label) {
    return null;
  }

  return (
    <span className={cn(baseClasses, BADGE_CLASSES)} title={`Created by ${label}`}>
      {label}
    </span>
  );
};
