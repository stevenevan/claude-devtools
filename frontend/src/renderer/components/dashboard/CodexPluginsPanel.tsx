import { JSX, useCallback, useEffect, useMemo, useState } from 'react';
import { api, isDesktopMode } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import { FolderOpen, Puzzle, RefreshCw } from 'lucide-react';

import type {
  CodexInventoryScope,
  CodexPluginCapabilityKind,
  CodexPluginList,
  CodexPluginSummary,
} from '@shared/types/api';
import type { UIMode } from '@shared/types';

import {
  CodexDiagnostics,
  codexScopeLabel,
  getCodexInspectionContext,
} from './CodexInventorySource';
import { InstallableList, type InstallableListItem } from './InstallableList';

interface CodexPluginsPanelProps {
  readonly mode: UIMode;
  readonly scope: CodexInventoryScope;
  readonly projectName?: string;
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function pluginStateLabel(state: CodexPluginSummary['state']): string {
  switch (state) {
    case 'installed':
      return 'Installed';
    case 'available':
      return 'Available';
    case 'disabled':
      return 'Disabled';
    case 'invalid':
      return 'Invalid';
    default:
      return 'Unknown';
  }
}

function capabilityLabel(kind: CodexPluginCapabilityKind): string {
  switch (kind) {
    case 'mcpServer':
      return 'MCP server';
    case 'skill':
      return 'Skill';
    case 'app':
      return 'App';
    case 'hook':
      return 'Hook';
    default:
      return kind;
  }
}

function stateTone(state: CodexPluginSummary['state']): string {
  return state === 'installed'
    ? 'bg-emerald-500/10 text-emerald-400'
    : state === 'invalid'
      ? 'bg-destructive/10 text-destructive'
      : 'bg-muted text-muted-foreground';
}

export const CodexPluginsPanel = ({
  mode,
  scope,
  projectName,
}: Readonly<CodexPluginsPanelProps>): JSX.Element => {
  const context = useMemo(() => getCodexInspectionContext(scope), [scope]);
  const [inventory, setInventory] = useState<CodexPluginList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setInventory(await api.getCodexPlugins(context));
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setLoading(false);
    }
  }, [context]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openFolder = async (): Promise<void> => {
    setOpening(true);
    setOpenError(null);
    try {
      await api.openCodexPluginsFolder();
    } catch (reason) {
      setOpenError(errorText(reason));
    } finally {
      setOpening(false);
    }
  };

  const items = inventory?.items ?? [];
  const counts = useMemo(
    () => ({
      installed: items.filter((plugin) => plugin.state === 'installed').length,
      available: items.filter((plugin) => plugin.state === 'available').length,
      capabilities: items.reduce((total, plugin) => total + plugin.capabilities.length, 0),
    }),
    [items]
  );
  const scopeLabel = codexScopeLabel(scope, projectName);

  return (
    <div className="bg-background flex flex-1 flex-col overflow-hidden">
      <div className="border-border/50 flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="text-foreground text-sm font-medium">Codex plugins</p>
          <p className="text-muted-foreground mt-0.5 max-w-2xl text-xs">
            Read-only inventory for the {scopeLabel.toLowerCase()}. Enablement is shown as
            unknown because the standalone plugin toggle key is not verified.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            Refresh
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!isDesktopMode() || opening}
            onClick={() => void openFolder()}
          >
            <FolderOpen className="size-3.5" />
            Open folder
          </Button>
        </div>
      </div>

      {(error || openError) && (
        <div className="border-border/50 bg-destructive/10 text-destructive border-b px-4 py-2 text-xs">
          {error ?? openError}
        </div>
      )}

      <div className="border-border/50 grid shrink-0 grid-cols-3 divide-x border-b">
        <SummaryMetric label="Installed" value={counts.installed} />
        <SummaryMetric label="Available" value={counts.available} />
        <SummaryMetric label="Capabilities" value={counts.capabilities} />
      </div>

      {loading ? (
        <p role="status" className="text-muted-foreground px-4 py-3 text-xs">
          Inspecting local Codex plugins…
        </p>
      ) : mode === 'simple' ? (
        <SimplePluginList plugins={items} />
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          {items.length === 0 ? (
            <EmptyPlugins />
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {items.map((plugin) => (
                <PluginCard key={plugin.id} plugin={plugin} />
              ))}
            </div>
          )}
        </div>
      )}

      {!loading && inventory && <CodexDiagnostics diagnostics={inventory.summary.diagnostics} />}
    </div>
  );
};

const SummaryMetric = ({ label, value }: Readonly<{ label: string; value: number }>): JSX.Element => (
  <div className="px-4 py-2.5">
    <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">{label}</p>
    <p className="text-foreground mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
  </div>
);

const SimplePluginList = ({
  plugins,
}: Readonly<{ plugins: readonly CodexPluginSummary[] }>): JSX.Element => {
  const items: InstallableListItem[] = plugins.map((plugin) => ({
    id: plugin.id,
    name: plugin.displayName ?? plugin.name,
    description: plugin.description || 'No description provided.',
    detail:
      String(plugin.capabilities.length) +
      (plugin.capabilities.length === 1 ? ' capability' : ' capabilities') +
      ' · Enablement unknown',
    source: plugin.source.label,
    stateLabel: pluginStateLabel(plugin.state),
  }));

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      <InstallableList
        items={items}
        ariaLabel="Codex plugins"
        emptyMessage="No Codex plugins were found in this scope."
      />
    </div>
  );
};

const PluginCard = ({ plugin }: Readonly<{ plugin: CodexPluginSummary }>): JSX.Element => (
  <article className="border-border bg-card/40 flex min-h-[180px] flex-col rounded-md border p-4">
    <div className="flex items-start gap-3">
      <div className="border-border bg-popover flex size-9 shrink-0 items-center justify-center rounded-md border">
        <Puzzle className="text-muted-foreground size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <h3 className="text-foreground truncate text-sm font-medium">
            {plugin.displayName ?? plugin.name}
          </h3>
          <span
            className={cn(
              'rounded-sm px-1.5 py-0.5 text-[10px] font-medium',
              stateTone(plugin.state)
            )}
          >
            {pluginStateLabel(plugin.state)}
          </span>
        </div>
        <p className="text-muted-foreground mt-1 truncate text-[10px]">{plugin.source.label}</p>
      </div>
    </div>

    <p className="text-muted-foreground mt-3 line-clamp-3 text-xs leading-relaxed">
      {plugin.description || 'No description provided.'}
    </p>

    <div className="mt-3 flex flex-wrap gap-1.5">
      {plugin.capabilities.length === 0 ? (
        <span className="text-muted-foreground text-[10px]">No declared capabilities</span>
      ) : (
        plugin.capabilities.map((capability) => (
          <span
            key={capability.kind + '-' + capability.name}
            className="border-border/60 text-muted-foreground rounded-sm border px-1.5 py-0.5 text-[10px]"
          >
            {capabilityLabel(capability.kind)} · {capability.name}
          </span>
        ))
      )}
    </div>

    <div className="border-border/50 text-muted-foreground mt-auto flex items-center justify-between gap-2 border-t pt-3 text-[10px]">
      <span>Enablement: unknown</span>
      {plugin.version && <span>Version {plugin.version}</span>}
    </div>
    <CodexDiagnostics diagnostics={plugin.diagnostics} />
  </article>
);

const EmptyPlugins = (): JSX.Element => (
  <div className="flex min-h-48 flex-col items-center justify-center rounded-md border border-dashed border-border px-8 py-12 text-center">
    <Puzzle className="text-muted-foreground mb-3 size-6" />
    <p className="text-muted-foreground text-sm">No Codex plugins were found.</p>
    <p className="text-muted-foreground mt-1 max-w-md text-xs">
      Installed and locally catalogued plugins appear here without installing or updating anything.
    </p>
  </div>
);
