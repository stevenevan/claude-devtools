import { useEffect, useMemo } from 'react';

import { useStore } from '@renderer/store';
import { Puzzle, Search } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { GlobalPlugin } from '@shared/types/api';

// =============================================================================
// Helpers
// =============================================================================

function formatPluginName(name: string): string {
  return name
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function formatVersion(version: string): string {
  // Truncate git SHA to 7 chars, keep semver as-is
  if (/^[0-9a-f]{12,}$/.test(version)) {
    return version.slice(0, 7);
  }
  return version;
}

function formatDate(isoDate: string): string {
  if (!isoDate) return '';
  try {
    return new Date(isoDate).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return isoDate;
  }
}

// =============================================================================
// Plugin Card
// =============================================================================

interface PluginCardProps {
  plugin: GlobalPlugin;
  isHighlighted?: boolean;
}

const PluginCard = ({ plugin, isHighlighted }: Readonly<PluginCardProps>): React.JSX.Element => {
  const displayName = formatPluginName(plugin.name);

  return (
    <div
      className={`group relative flex min-h-[120px] flex-col overflow-hidden rounded-xs border p-4 text-left transition-all duration-300 ${
        isHighlighted
          ? 'border-border-emphasis bg-surface-raised'
          : 'bg-surface/50 border-border hover:border-border-emphasis hover:bg-surface-raised'
      } `}
    >
      <div className="mb-3 flex items-center gap-2">
        <div className="border-border bg-surface-overlay group-hover:border-border-emphasis flex size-8 items-center justify-center rounded-xs border transition-colors duration-300">
          <Puzzle className="text-text-secondary group-hover:text-text size-4 transition-colors" />
        </div>
        <span
          className={`rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${
            plugin.enabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-500/10 text-zinc-500'
          }`}
        >
          {plugin.enabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>

      <h3 className="text-text group-hover:text-text mb-1 truncate text-sm font-medium transition-colors duration-200">
        {displayName}
      </h3>

      <p className="text-text-muted mb-auto truncate text-[10px]">{plugin.marketplace}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {plugin.version && (
          <span className="text-text-secondary text-[10px]">v{formatVersion(plugin.version)}</span>
        )}
        {plugin.lastUpdated && (
          <>
            <span className="text-text-muted">·</span>
            <span className="text-text-muted text-[10px]">{formatDate(plugin.lastUpdated)}</span>
          </>
        )}
      </div>
    </div>
  );
};

// =============================================================================
// Skeleton
// =============================================================================

const PluginsGridSkeleton = (): React.JSX.Element => {
  const titleWidths = [55, 65, 50, 70, 60, 45];
  const metaWidths = [70, 60, 80, 65, 75, 55];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="skeleton-card border-border flex min-h-[120px] flex-col rounded-xs border bg-[var(--skeleton-base)] p-4"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <div className="mb-3 flex items-center gap-2">
            <div className="size-8 rounded-xs bg-[var(--skeleton-base-light)]" />
            <div className="h-4 w-14 rounded-sm bg-[var(--skeleton-base-dim)]" />
          </div>
          <div
            className="mb-2 h-3.5 rounded-xs bg-[var(--skeleton-base-light)]"
            style={{ width: `${titleWidths[i]}%` }}
          />
          <div
            className="mb-auto h-2.5 rounded-xs bg-[var(--skeleton-base-dim)]"
            style={{ width: `${metaWidths[i]}%` }}
          />
        </div>
      ))}
    </div>
  );
};

// =============================================================================
// Plugins Grid
// =============================================================================

interface PluginsGridProps {
  searchQuery: string;
}

export const PluginsGrid = ({ searchQuery }: Readonly<PluginsGridProps>): React.JSX.Element => {
  const { globalPlugins, globalPluginsLoading, fetchGlobalPlugins } = useStore(
    useShallow((s) => ({
      globalPlugins: s.globalPlugins,
      globalPluginsLoading: s.globalPluginsLoading,
      fetchGlobalPlugins: s.fetchGlobalPlugins,
    }))
  );

  useEffect(() => {
    if (globalPlugins.length === 0 && !globalPluginsLoading) {
      void fetchGlobalPlugins();
    }
  }, [globalPlugins.length, globalPluginsLoading, fetchGlobalPlugins]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return globalPlugins;
    const query = searchQuery.toLowerCase().trim();
    return globalPlugins.filter(
      (p) => p.name.toLowerCase().includes(query) || p.marketplace.toLowerCase().includes(query)
    );
  }, [globalPlugins, searchQuery]);

  if (globalPluginsLoading) return <PluginsGridSkeleton />;

  if (filtered.length === 0 && searchQuery.trim()) {
    return (
      <div className="border-border flex flex-col items-center justify-center rounded-xs border border-dashed px-8 py-16">
        <div className="border-border bg-surface-raised mb-4 flex size-12 items-center justify-center rounded-xs border">
          <Search className="text-text-muted size-6" />
        </div>
        <p className="text-text-secondary mb-1 text-sm">No plugins found</p>
        <p className="text-text-muted text-xs">No matches for &quot;{searchQuery}&quot;</p>
      </div>
    );
  }

  if (globalPlugins.length === 0) {
    return (
      <div className="border-border flex flex-col items-center justify-center rounded-xs border border-dashed px-8 py-16">
        <div className="border-border bg-surface-raised mb-4 flex size-12 items-center justify-center rounded-xs border">
          <Puzzle className="text-text-muted size-6" />
        </div>
        <p className="text-text-secondary mb-1 text-sm">No plugins found</p>
        <p className="text-text-muted font-mono text-xs">~/.claude/plugins/</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
      {filtered.map((plugin) => (
        <PluginCard key={plugin.id} plugin={plugin} isHighlighted={!!searchQuery.trim()} />
      ))}
    </div>
  );
};
