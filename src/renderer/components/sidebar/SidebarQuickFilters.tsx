/**
 * SidebarQuickFilters - Toggleable filter chips for the session list.
 * Filters: Ongoing, With Subagents
 */

import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { Activity, Bookmark, GitBranch } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

export type SidebarFilter = 'ongoing' | 'subagents' | 'bookmarked';

const FILTERS: { value: SidebarFilter; label: string; icon: React.ElementType }[] = [
  { value: 'ongoing', label: 'Ongoing', icon: Activity },
  { value: 'subagents', label: 'Subagents', icon: GitBranch },
  { value: 'bookmarked', label: 'Bookmarked', icon: Bookmark },
];

interface SidebarQuickFiltersProps {
  activeFilters: Set<SidebarFilter>;
  onToggle: (filter: SidebarFilter) => void;
}

export const SidebarQuickFilters = ({
  activeFilters,
  onToggle,
}: Readonly<SidebarQuickFiltersProps>): React.JSX.Element => {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5">
      {FILTERS.map(({ value, label, icon: Icon }) => {
        const isActive = activeFilters.has(value);
        return (
          <button
            key={value}
            onClick={() => onToggle(value)}
            className={cn(
              'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors',
              isActive
                ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-300'
                : 'border-border text-muted-foreground hover:border-zinc-500 hover:text-foreground'
            )}
          >
            <Icon className="size-2.5" />
            {label}
          </button>
        );
      })}
      {activeFilters.size > 0 && (
        <button
          onClick={() => {
            for (const f of activeFilters) onToggle(f);
          }}
          className="text-muted-foreground hover:text-foreground text-[10px] transition-colors"
        >
          Clear
        </button>
      )}
    </div>
  );
};
