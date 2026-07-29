import { JSX, useEffect, useState } from 'react';
import { api, isDesktopMode } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { useClipboard } from '@renderer/hooks/mantine';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { Check, Copy, Puzzle, RefreshCw, Store } from 'lucide-react';

import type { CatalogPlugin, DuplicateGroup, GlobalPlugin, MarketplaceView } from '@shared/types/api';

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Read-only view of ~/.claude/plugins marketplace catalog. Master-detail: pick
// a marketplace on the left, its plugins render as cards on the right
// (mirrors PluginsGrid.tsx's card markup). Enable/disable is the only write
// action, gated behind canAct (local desktop mode only).
export const MarketplaceBrowser = (): JSX.Element => {
  const connectionMode = useStore((s) => s.connectionMode);
  const canAct = isDesktopMode() && connectionMode === 'local';

  const [marketplaces, setMarketplaces] = useState<MarketplaceView[]>([]);
  const [globalPlugins, setGlobalPlugins] = useState<GlobalPlugin[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);

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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-border/50 flex shrink-0 items-start justify-between gap-2 border-b px-4 py-3">
        <div>
          <p className="text-foreground text-sm font-medium">Marketplace</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Browse plugin marketplaces under ~/.claude/plugins. Installed plugins can be
            enabled or disabled from this machine.
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
            globalPlugins={globalPlugins}
            duplicates={duplicates}
            canAct={canAct}
            onReload={load}
          />
        </div>
      </div>
    </div>
  );
};

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
  globalPlugins: GlobalPlugin[];
  duplicates: DuplicateGroup[];
  canAct: boolean;
  onReload: () => Promise<void>;
}

const MarketplaceDetail = ({
  marketplace,
  loading,
  globalPlugins,
  duplicates,
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
          marketplaceName={marketplace.name}
          globalPlugin={
            globalPlugins.find(
              (p) => p.name === plugin.name && p.marketplace === marketplace.name
            ) ?? null
          }
          duplicateGroup={duplicates.find((d) => d.name === plugin.name) ?? null}
          canAct={canAct}
          onReload={onReload}
        />
      ))}
    </div>
  );
};

interface PluginCatalogCardProps {
  plugin: CatalogPlugin;
  marketplaceName: string;
  globalPlugin: GlobalPlugin | null;
  duplicateGroup: DuplicateGroup | null;
  canAct: boolean;
  onReload: () => Promise<void>;
}

const PluginCatalogCard = ({
  plugin,
  marketplaceName,
  globalPlugin,
  duplicateGroup,
  canAct,
  onReload,
}: Readonly<PluginCatalogCardProps>): JSX.Element => {
  const { copy, copied } = useClipboard({ timeout: 2000 });
  const [toggling, setToggling] = useState(false);

  const handleToggle = async (): Promise<void> => {
    if (!globalPlugin) return;
    setToggling(true);
    try {
      await api.setPluginEnabled(globalPlugin.id, !globalPlugin.enabled);
      await onReload();
    } finally {
      setToggling(false);
    }
  };

  const installCommand = `claude plugin install ${plugin.name}@${marketplaceName}`;

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
        ) : (
          <>
            <span className="text-muted-foreground text-[10px]">Install via CLI:</span>
            <code className="bg-card/50 text-foreground truncate rounded-sm px-1.5 py-0.5 font-mono text-[10px]">
              {installCommand}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              title="Copy command"
              onClick={() => copy(installCommand)}
            >
              {copied ? (
                <Check className="size-2.5 text-emerald-500" />
              ) : (
                <Copy className="size-2.5" />
              )}
            </Button>
          </>
        )}
      </div>
    </div>
  );
};
