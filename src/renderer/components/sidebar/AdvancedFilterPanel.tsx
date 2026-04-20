import { useMemo, useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { ChevronDown, ChevronRight, Filter, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { SessionFilterState } from '@renderer/store/slices/sessionSlice';

function countActive(filters: SessionFilterState): number {
  let count = 0;
  if (filters.dateMin != null) count++;
  if (filters.dateMax != null) count++;
  if (filters.minContext != null) count++;
  if (filters.maxContext != null) count++;
  if (filters.minCompactions != null && filters.minCompactions > 0) count++;
  if (filters.agentName?.trim()) count++;
  if (filters.tags && filters.tags.length > 0) count++;
  return count;
}

function toInputDate(ts: number | undefined): string {
  if (!ts) return '';
  return new Date(ts).toISOString().slice(0, 10);
}

function fromInputDate(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export const AdvancedFilterPanel = (): React.JSX.Element => {
  const { activeFilters, setFilter, clearFilters, sessionTags } = useStore(
    useShallow((s) => ({
      activeFilters: s.activeFilters,
      setFilter: s.setFilter,
      clearFilters: s.clearFilters,
      sessionTags: s.sessionTags,
    }))
  );

  const [expanded, setExpanded] = useState(false);
  const badgeCount = countActive(activeFilters);

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const tags of sessionTags.values()) {
      for (const tag of tags) set.add(tag);
    }
    return Array.from(set).sort();
  }, [sessionTags]);

  const toggleTag = (tag: string): void => {
    const current = activeFilters.tags ?? [];
    const next = current.includes(tag)
      ? current.filter((t) => t !== tag)
      : [...current, tag];
    setFilter({ tags: next.length > 0 ? next : undefined });
  };

  return (
    <div className="border-border/60 border-b">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="group text-muted-foreground hover:text-foreground flex w-full items-center justify-between px-3 py-1.5 text-[11px]"
      >
        <span className="flex items-center gap-1.5">
          {expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
          <Filter className="size-3" />
          Advanced filters
          {badgeCount > 0 && (
            <span className="bg-primary/20 text-primary ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium">
              {badgeCount}
            </span>
          )}
        </span>
        {badgeCount > 0 && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear all filters"
            onClick={(e) => {
              e.stopPropagation();
              clearFilters();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                clearFilters();
              }
            }}
            className="hover:text-foreground inline-flex cursor-pointer items-center gap-0.5"
          >
            <X className="size-3" /> Clear
          </span>
        )}
      </button>

      {expanded && (
        <div className="bg-surface-sidebar flex flex-col gap-3 px-3 py-2 text-[11px]">
          <FilterField label="From">
            <input
              type="date"
              value={toInputDate(activeFilters.dateMin)}
              onChange={(e) => setFilter({ dateMin: fromInputDate(e.target.value) })}
              className="border-border bg-background text-foreground w-full rounded-sm border px-1.5 py-0.5"
            />
          </FilterField>
          <FilterField label="To">
            <input
              type="date"
              value={toInputDate(activeFilters.dateMax)}
              onChange={(e) => setFilter({ dateMax: fromInputDate(e.target.value) })}
              className="border-border bg-background text-foreground w-full rounded-sm border px-1.5 py-0.5"
            />
          </FilterField>

          <div className="grid grid-cols-2 gap-2">
            <FilterField label="Min context">
              <input
                type="number"
                min={0}
                step={1000}
                value={activeFilters.minContext ?? ''}
                onChange={(e) =>
                  setFilter({
                    minContext: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
                placeholder="tokens"
                className="border-border bg-background text-foreground w-full rounded-sm border px-1.5 py-0.5"
              />
            </FilterField>
            <FilterField label="Max context">
              <input
                type="number"
                min={0}
                step={1000}
                value={activeFilters.maxContext ?? ''}
                onChange={(e) =>
                  setFilter({
                    maxContext: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
                placeholder="tokens"
                className="border-border bg-background text-foreground w-full rounded-sm border px-1.5 py-0.5"
              />
            </FilterField>
          </div>

          <FilterField label="Min compactions">
            <input
              type="number"
              min={0}
              value={activeFilters.minCompactions ?? 0}
              onChange={(e) =>
                setFilter({
                  minCompactions: Number(e.target.value) || undefined,
                })
              }
              className="border-border bg-background text-foreground w-full rounded-sm border px-1.5 py-0.5"
            />
          </FilterField>

          <FilterField label="Agent name">
            <input
              type="text"
              value={activeFilters.agentName ?? ''}
              onChange={(e) => setFilter({ agentName: e.target.value || undefined })}
              placeholder="any"
              className="border-border bg-background text-foreground w-full rounded-sm border px-1.5 py-0.5"
            />
          </FilterField>

          {availableTags.length > 0 && (
            <div>
              <div className="text-muted-foreground mb-1 text-[10px] font-medium uppercase tracking-wider">
                Tags
              </div>
              <div className="flex flex-wrap gap-1">
                {availableTags.map((tag) => {
                  const active = activeFilters.tags?.includes(tag) ?? false;
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[10px] transition-colors',
                        active
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {badgeCount > 0 && (
            <Button variant="secondary" size="sm" onClick={clearFilters} className="self-start">
              Clear all
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

const FilterField = ({
  label,
  children,
}: Readonly<{ label: string; children: React.ReactNode }>): React.JSX.Element => (
  <label className="flex flex-col gap-1">
    <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">
      {label}
    </span>
    {children}
  </label>
);
