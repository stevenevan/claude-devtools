import { JSX, useEffect, useMemo, useState } from 'react';
import { api, isDesktopMode } from '@renderer/api';
import { CopyButton } from '@renderer/components/common/CopyButton';
import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select';
import { useUIMode } from '@renderer/hooks/useUIMode';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { Puzzle, RefreshCw, Search, Store } from 'lucide-react';
import { sanitizeSimpleText } from '@renderer/utils/simpleTextSanitizer';

import type { CatalogPlugin, DuplicateGroup, GlobalPlugin, MarketplaceView } from '@shared/types/api';

import { InstallableList, type InstallableListItem } from './InstallableList';

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface MarketplacePluginEntry {
  marketplace: MarketplaceView;
  plugin: CatalogPlugin;
}

export function marketplacePluginKey(marketplaceName: string, pluginName: string): string {
  return `${marketplaceName}\0${pluginName}`;
}

export function buildSimpleMarketplaceEntries(
  marketplaces: readonly MarketplaceView[],
  marketplaceFilter: string,
  query: string
): MarketplacePluginEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  return marketplaces
    .flatMap((marketplace) =>
      marketplace.plugins.map((plugin) => ({ marketplace, plugin }))
    )
    .filter(
      ({ marketplace }) => marketplaceFilter === 'all' || marketplace.name === marketplaceFilter
    )
    .filter(({ marketplace, plugin }) => {
      if (!normalizedQuery) return true;
      return [
        marketplace.name,
        marketplace.source ?? '',
        plugin.name,
        plugin.description ?? '',
      ].some((value) => value.toLowerCase().includes(normalizedQuery));
    })
    .sort((a, b) => {
      const installedOrder = Number(a.plugin.installed) - Number(b.plugin.installed);
      if (installedOrder !== 0) return installedOrder;
      return `${a.marketplace.name}\0${a.plugin.name}`.localeCompare(
        `${b.marketplace.name}\0${b.plugin.name}`
      );
    });
}

export function indexGlobalPlugins(globalPlugins: readonly GlobalPlugin[]): Map<string, GlobalPlugin> {
  return new Map(
    globalPlugins.map((plugin) => [marketplacePluginKey(plugin.marketplace, plugin.name), plugin])
  );
}

export function indexDuplicateGroups(
  duplicates: readonly DuplicateGroup[]
): Map<string, DuplicateGroup> {
  return new Map(duplicates.map((group) => [group.name, group]));
}

// Read-only view of ~/.claude/plugins marketplace catalog. Master-detail: pick
// a marketplace on the left, its plugins render as cards on the right
// (mirrors PluginsGrid.tsx's card markup). Enable/disable is the only write
// action, gated behind canAct (local desktop mode only).
export const MarketplaceBrowser = (): JSX.Element => {
  const mode = useUIMode();
  const connectionMode = useStore((s) => s.connectionMode);
  const canAct = isDesktopMode() && connectionMode === 'local';

  const [marketplaces, setMarketplaces] = useState<MarketplaceView[]>([]);
  const [globalPlugins, setGlobalPlugins] = useState<GlobalPlugin[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [simpleMarketplaceFilter, setSimpleMarketplaceFilter] = useState('all');
  const [simpleQuery, setSimpleQuery] = useState('');
  const [installCommand, setInstallCommand] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [catalog, plugins, duplicateGroups] = await Promise.all([
        api.readMarketplaceCatalog(),
        api.readGlobalPlugins(),
        api.detectPluginDuplicates(),
      ]);
      setMarketplaces(catalog.marketplaces);
      setGlobalPlugins(plugins);
      setDuplicates(duplicateGroups);
      setSelectedName((current) =>
        current && catalog.marketplaces.some((m) => m.name === current)
          ? current
          : (catalog.marketplaces[0]?.name ?? null)
      );
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const selected = marketplaces.find((m) => m.name === selectedName) ?? null;
  const globalPluginsByKey = useMemo(() => indexGlobalPlugins(globalPlugins), [globalPlugins]);
  const duplicateGroupsByName = useMemo(() => indexDuplicateGroups(duplicates), [duplicates]);
  const simpleEntries = useMemo(
    () => buildSimpleMarketplaceEntries(marketplaces, simpleMarketplaceFilter, simpleQuery),
    [marketplaces, simpleMarketplaceFilter, simpleQuery]
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-border/50 flex shrink-0 items-start justify-between gap-2 border-b px-4 py-3">
        <div>
          <p className="text-foreground text-sm font-medium">Marketplace</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {mode === 'simple'
              ? 'Find add-ons from local marketplace catalogs. Third-party add-ons can read or change files.'
              : 'Browse plugin marketplaces under ~/.claude/plugins. Installed plugins can be enabled or disabled from this machine.'}
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => void load()}>
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="border-border/50 bg-destructive/10 text-destructive shrink-0 border-b px-4 py-2 text-xs"
        >
          {error}
        </div>
      )}

      {mode === 'simple' ? (
        <SimpleMarketplaceContent
          marketplaces={marketplaces}
          entries={simpleEntries}
          globalPluginsByKey={globalPluginsByKey}
          canAct={canAct}
          loading={loading}
          marketplaceFilter={simpleMarketplaceFilter}
          query={simpleQuery}
          onMarketplaceFilterChange={setSimpleMarketplaceFilter}
          onQueryChange={setSimpleQuery}
          onInstall={setInstallCommand}
          onReload={load}
        />
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <div
            aria-label="Marketplaces"
            className="border-border/50 w-64 shrink-0 overflow-y-auto border-r"
          >
            {loading ? (
              <p role="status" className="text-muted-foreground px-4 py-3 text-xs">
                Loading…
              </p>
            ) : marketplaces.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                <Store className="text-muted-foreground size-6 opacity-50" />
                <p className="text-muted-foreground text-xs">
                  No marketplaces found under ~/.claude/plugins.
                </p>
              </div>
            ) : (
              marketplaces.map((marketplace) => (
                <MarketplaceRow
                  key={marketplace.name}
                  marketplace={marketplace}
                  selected={marketplace.name === selectedName}
                  onSelect={() => setSelectedName(marketplace.name)}
                />
              ))
            )}
          </div>

          <div className="min-w-0 flex-1 overflow-y-auto p-4">
            <MarketplaceDetail
              marketplace={selected}
              loading={loading}
              globalPluginsByKey={globalPluginsByKey}
              duplicateGroupsByName={duplicateGroupsByName}
              canAct={canAct}
              onReload={load}
            />
          </div>
        </div>
      )}

      <InstallInstructionsDialog
        command={installCommand}
        onOpenChange={(open) => {
          if (!open) setInstallCommand(null);
        }}
      />
    </div>
  );
};

interface SimpleMarketplaceContentProps {
  marketplaces: readonly MarketplaceView[];
  entries: readonly MarketplacePluginEntry[];
  globalPluginsByKey: ReadonlyMap<string, GlobalPlugin>;
  canAct: boolean;
  loading: boolean;
  marketplaceFilter: string;
  query: string;
  onMarketplaceFilterChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onInstall: (command: string) => void;
  onReload: () => Promise<void>;
}

const SimpleMarketplaceContent = ({
  marketplaces,
  entries,
  globalPluginsByKey,
  canAct,
  loading,
  marketplaceFilter,
  query,
  onMarketplaceFilterChange,
  onQueryChange,
  onInstall,
  onReload,
}: Readonly<SimpleMarketplaceContentProps>): JSX.Element => {
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleToggle = async (plugin: GlobalPlugin): Promise<void> => {
    setTogglingId(plugin.id);
    setActionError(null);
    try {
      await api.setPluginEnabled(plugin.id, !plugin.enabled);
      await onReload();
    } catch (err) {
      setActionError(errText(err));
    } finally {
      setTogglingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p role="status" className="text-muted-foreground text-sm">
          Loading marketplace catalog…
        </p>
      </div>
    );
  }

  if (marketplaces.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <Store className="text-muted-foreground size-6 opacity-50" />
        <p className="text-muted-foreground text-sm">No marketplace catalog found.</p>
        <p className="text-muted-foreground max-w-md text-xs">
          Add-ons appear here after Claude Code has a local marketplace catalog.
        </p>
      </div>
    );
  }

  const items: InstallableListItem[] = entries.map(({ marketplace, plugin }) => {
    const globalPlugin = globalPluginsByKey.get(marketplacePluginKey(marketplace.name, plugin.name));
    const displayName = sanitizeSimpleText(plugin.name);
    const installable = !plugin.installed && plugin.installCommand;
    const description = plugin.description ? sanitizeSimpleText(plugin.description) : undefined;
    const source = marketplace.source ? sanitizeSimpleText(marketplace.source) : 'Unknown source';

    return {
      id: marketplacePluginKey(marketplace.name, plugin.name),
      name: displayName,
      description,
      detail: globalPlugin
        ? `Installed from ${sanitizeSimpleText(marketplace.name)}`
        : plugin.installed
          ? 'Installed'
          : installable
            ? undefined
            : 'Installation instructions unavailable for this catalog entry.',
      source,
      stateLabel: plugin.installed
        ? globalPlugin
          ? globalPlugin.enabled
            ? 'Installed · On'
            : 'Installed · Off'
          : 'Installed'
        : 'Available',
      action: globalPlugin && canAct
        ? {
            label: globalPlugin.enabled ? 'Turn off' : 'Turn on',
            ariaLabel: `${globalPlugin.enabled ? 'Turn off' : 'Turn on'} ${displayName}`,
            disabled: togglingId === globalPlugin.id,
            onClick: () => void handleToggle(globalPlugin),
          }
        : installable
          ? {
              label: 'How to install',
              onClick: () => onInstall(plugin.installCommand as string),
            }
          : undefined,
    };
  });

  return (
    <div className="min-w-0 flex-1 overflow-y-auto p-4">
      <div className="mb-4 flex flex-col gap-3">
        <p className="text-muted-foreground text-xs">
          Review an add-on&apos;s source before installing. Claude Code installs plugins through
          its own CLI; this page only provides instructions.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="min-w-0 flex-1">
            <label className="sr-only" htmlFor="marketplace-plugin-search">
              Search add-ons
            </label>
            <div className="relative">
              <Search
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2"
                aria-hidden="true"
              />
              <Input
                id="marketplace-plugin-search"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Search add-ons"
                className="pl-7"
              />
            </div>
          </div>
          <Select value={marketplaceFilter} onValueChange={(value) => onMarketplaceFilterChange(value ?? 'all')}>
            <SelectTrigger aria-label="Filter marketplaces" className="w-full sm:w-56">
              <SelectValue placeholder="All marketplaces" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All marketplaces</SelectItem>
              {marketplaces.map((marketplace) => (
                <SelectItem key={marketplace.name} value={marketplace.name}>
                  {marketplace.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!canAct && (
        <p className="text-muted-foreground mb-3 text-xs">
          Add-on controls are available only on this local desktop.
        </p>
      )}
      {actionError && (
        <p role="alert" className="text-destructive mb-3 text-xs">
          {actionError}
        </p>
      )}
      {entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">No add-ons match this search.</p>
      ) : (
        <InstallableList
          items={items}
          ariaLabel="Marketplace add-ons"
          emptyMessage="No add-ons found."
        />
      )}
    </div>
  );
};

const InstallInstructionsDialog = ({
  command,
  onOpenChange,
}: Readonly<{ command: string | null; onOpenChange: (open: boolean) => void }>): JSX.Element => (
  <Dialog open={command !== null} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>How to install</DialogTitle>
        <DialogDescription>
          Run this command in Claude Code&apos;s supported CLI environment. Nothing is installed by
          this page.
        </DialogDescription>
      </DialogHeader>
      {command && (
        <div className="bg-muted flex items-center justify-between gap-2 rounded-md px-3 py-2">
          <code className="text-foreground min-w-0 break-all font-mono text-xs">{command}</code>
          <CopyButton text={command} label="Copy install command" inline />
        </div>
      )}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

interface MarketplaceRowProps {
  marketplace: MarketplaceView;
  selected: boolean;
  onSelect: () => void;
}

const MarketplaceRow = ({
  marketplace,
  selected,
  onSelect,
}: Readonly<MarketplaceRowProps>): JSX.Element => (
  <Button
    variant="ghost"
    aria-current={selected || undefined}
    onClick={onSelect}
    className={cn(
      'h-auto w-full min-w-0 flex-col items-start gap-0.5 rounded-none border-b px-4 py-2 text-left',
      selected ? 'bg-card/60' : 'hover:bg-card/30'
    )}
  >
    <span className="text-foreground w-full truncate text-xs font-medium">
      {marketplace.name}
    </span>
    <span className="text-muted-foreground w-full truncate text-[10px]">
      {marketplace.source ?? 'unknown source'} · {marketplace.plugins.length} plugin
      {marketplace.plugins.length === 1 ? '' : 's'}
    </span>
  </Button>
);

interface MarketplaceDetailProps {
  marketplace: MarketplaceView | null;
  loading: boolean;
  globalPluginsByKey: ReadonlyMap<string, GlobalPlugin>;
  duplicateGroupsByName: ReadonlyMap<string, DuplicateGroup>;
  canAct: boolean;
  onReload: () => Promise<void>;
}

const MarketplaceDetail = ({
  marketplace,
  loading,
  globalPluginsByKey,
  duplicateGroupsByName,
  canAct,
  onReload,
}: Readonly<MarketplaceDetailProps>): JSX.Element => {
  if (loading) {
    return <p className="text-muted-foreground px-4 py-3 text-xs">Loading…</p>;
  }
  if (!marketplace) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <Store className="text-muted-foreground size-6 opacity-50" />
        <p className="text-muted-foreground text-xs">Select a marketplace to view its plugins.</p>
      </div>
    );
  }
  if (marketplace.plugins.length === 0) {
    return (
      <p className="text-muted-foreground px-4 py-3 text-xs">
        No plugins listed in this marketplace&apos;s manifest.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
      {marketplace.plugins.map((plugin) => (
        <PluginCatalogCard
          key={plugin.name}
          plugin={plugin}
          globalPlugin={
            globalPluginsByKey.get(marketplacePluginKey(marketplace.name, plugin.name)) ?? null
          }
          duplicateGroup={duplicateGroupsByName.get(plugin.name) ?? null}
          canAct={canAct}
          onReload={onReload}
        />
      ))}
    </div>
  );
};

interface PluginCatalogCardProps {
  plugin: CatalogPlugin;
  globalPlugin: GlobalPlugin | null;
  duplicateGroup: DuplicateGroup | null;
  canAct: boolean;
  onReload: () => Promise<void>;
}

const PluginCatalogCard = ({
  plugin,
  globalPlugin,
  duplicateGroup,
  canAct,
  onReload,
}: Readonly<PluginCatalogCardProps>): JSX.Element => {
  const [toggling, setToggling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleToggle = async (): Promise<void> => {
    if (!globalPlugin) return;
    setToggling(true);
    setActionError(null);
    try {
      await api.setPluginEnabled(globalPlugin.id, !globalPlugin.enabled);
      await onReload();
    } catch (err) {
      setActionError(errText(err));
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="group bg-background/50 border-border hover:bg-card relative flex min-h-[120px] flex-col overflow-hidden rounded-xs border p-4 text-left transition-all duration-300">
      <div className="mb-3 flex items-center gap-2">
        <div className="border-border bg-popover flex size-8 items-center justify-center rounded-xs border transition-colors duration-300">
          <Puzzle className="text-muted-foreground group-hover:text-foreground size-4 transition-colors" />
        </div>
        {plugin.installed && (
          <span className="rounded-sm bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
            Installed
          </span>
        )}
      </div>

      <h3 className="text-foreground mb-1 truncate text-sm font-medium transition-colors duration-200">
        {plugin.name}
      </h3>

      <p className="text-muted-foreground text-[10px]">{plugin.description}</p>

      {actionError && (
        <p role="alert" className="text-destructive mt-2 text-[10px]">
          {actionError}
        </p>
      )}

      {duplicateGroup && (
        <p className="mt-2 text-[10px] text-amber-500">
          Enabled under multiple marketplaces:{' '}
          {duplicateGroup.entries.map((entry) => entry.marketplace).join(', ')}
        </p>
      )}

      <div className="mt-auto flex items-center gap-1.5 pt-3">
        {globalPlugin ? (
          canAct && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={toggling}
              onClick={() => void handleToggle()}
            >
              {globalPlugin.enabled ? 'Disable' : 'Enable'}
            </Button>
          )
        ) : plugin.installed ? (
          <span className="text-muted-foreground text-[10px]">
            Installed; enable/disable state is unavailable.
          </span>
        ) : (
          <>
            {plugin.installCommand ? (
              <>
                <span className="text-muted-foreground text-[10px]">Install via CLI:</span>
                <code className="bg-card/50 text-foreground truncate rounded-sm px-1.5 py-0.5 font-mono text-[10px]">
                  {plugin.installCommand}
                </code>
                <CopyButton text={plugin.installCommand} label="Copy install command" inline />
              </>
            ) : (
              <span className="text-muted-foreground text-[10px]">
                Installation instructions unavailable for this catalog entry.
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
};
