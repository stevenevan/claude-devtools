import { useEffect, useMemo } from 'react';

import { api } from '@renderer/api';
import { useStore } from '@renderer/store';
import { Search, Sparkles } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { GlobalSkill } from '@shared/types/api';

// =============================================================================
// Helpers
// =============================================================================

function formatSkillName(name: string): string {
  return name
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// =============================================================================
// Skill Card
// =============================================================================

interface SkillCardProps {
  skill: GlobalSkill;
  isHighlighted?: boolean;
}

const SkillCard = ({ skill, isHighlighted }: Readonly<SkillCardProps>): React.JSX.Element => {
  const displayName = formatSkillName(skill.name);

  return (
    <button
      onClick={() => void api.openPath(skill.resolvedPath)}
      className={`group relative flex min-h-[120px] flex-col overflow-hidden rounded-xs border p-4 text-left transition-all duration-300 ${
        isHighlighted
          ? 'border-border-emphasis bg-surface-raised'
          : 'bg-surface/50 border-border hover:border-border-emphasis hover:bg-surface-raised'
      } `}
    >
      <div className="border-border bg-surface-overlay group-hover:border-border-emphasis mb-3 flex size-8 items-center justify-center rounded-xs border transition-colors duration-300">
        <Sparkles className="text-text-secondary group-hover:text-text size-4 transition-colors" />
      </div>

      <h3 className="text-text group-hover:text-text mb-1 truncate text-sm font-medium transition-colors duration-200">
        {displayName}
      </h3>

      <p className="text-text-muted mb-auto line-clamp-2 text-[10px]">{skill.description}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {skill.userInvocable && (
          <span className="border-border bg-surface-overlay rounded-sm border px-1.5 py-0.5 text-[10px] text-emerald-400">
            User Invocable
          </span>
        )}
      </div>
    </button>
  );
};

// =============================================================================
// Skeleton
// =============================================================================

const SkillsGridSkeleton = (): React.JSX.Element => {
  const titleWidths = [55, 70, 60, 50];
  const descWidths = [80, 90, 75, 85];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="skeleton-card border-border flex min-h-[120px] flex-col rounded-xs border p-4"
          style={{ animationDelay: `${i * 80}ms`, backgroundColor: 'var(--skeleton-base)' }}
        >
          <div
            className="mb-3 size-8 rounded-xs"
            style={{ backgroundColor: 'var(--skeleton-base-light)' }}
          />
          <div
            className="mb-2 h-3.5 rounded-xs"
            style={{ width: `${titleWidths[i]}%`, backgroundColor: 'var(--skeleton-base-light)' }}
          />
          <div
            className="mb-auto h-2.5 rounded-xs"
            style={{ width: `${descWidths[i]}%`, backgroundColor: 'var(--skeleton-base-dim)' }}
          />
        </div>
      ))}
    </div>
  );
};

// =============================================================================
// Skills Grid
// =============================================================================

interface SkillsGridProps {
  searchQuery: string;
}

export const SkillsGrid = ({ searchQuery }: Readonly<SkillsGridProps>): React.JSX.Element => {
  const { globalSkills, globalSkillsLoading, fetchGlobalSkills } = useStore(
    useShallow((s) => ({
      globalSkills: s.globalSkills,
      globalSkillsLoading: s.globalSkillsLoading,
      fetchGlobalSkills: s.fetchGlobalSkills,
    }))
  );

  useEffect(() => {
    if (globalSkills.length === 0 && !globalSkillsLoading) {
      void fetchGlobalSkills();
    }
  }, [globalSkills.length, globalSkillsLoading, fetchGlobalSkills]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return globalSkills;
    const query = searchQuery.toLowerCase().trim();
    return globalSkills.filter(
      (s) => s.name.toLowerCase().includes(query) || s.description.toLowerCase().includes(query)
    );
  }, [globalSkills, searchQuery]);

  if (globalSkillsLoading) return <SkillsGridSkeleton />;

  if (filtered.length === 0 && searchQuery.trim()) {
    return (
      <div className="border-border flex flex-col items-center justify-center rounded-xs border border-dashed px-8 py-16">
        <div className="border-border bg-surface-raised mb-4 flex size-12 items-center justify-center rounded-xs border">
          <Search className="text-text-muted size-6" />
        </div>
        <p className="text-text-secondary mb-1 text-sm">No skills found</p>
        <p className="text-text-muted text-xs">No matches for &quot;{searchQuery}&quot;</p>
      </div>
    );
  }

  if (globalSkills.length === 0) {
    return (
      <div className="border-border flex flex-col items-center justify-center rounded-xs border border-dashed px-8 py-16">
        <div className="border-border bg-surface-raised mb-4 flex size-12 items-center justify-center rounded-xs border">
          <Sparkles className="text-text-muted size-6" />
        </div>
        <p className="text-text-secondary mb-1 text-sm">No skills found</p>
        <p className="text-text-muted font-mono text-xs">~/.claude/skills/</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
      {filtered.map((skill) => (
        <SkillCard key={skill.name} skill={skill} isHighlighted={!!searchQuery.trim()} />
      ))}
    </div>
  );
};
