import { JSX, useEffect, useState } from 'react';
import { api, isDesktopMode } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { Switch } from '@renderer/components/ui/switch';
import { useStore } from '@renderer/store';
import { Loader2 } from 'lucide-react';

import type { DuplicateGroup, GlobalPlugin } from '@shared/types/api';

export const PluginsPanel = (): JSX.Element => {
  const connectionMode = useStore((s) => s.connectionMode);
  const canAct = isDesktopMode() && connectionMode === 'local';

  const [plugins, setPlugins] = useState<GlobalPlugin[] | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const [pluginList, duplicateGroups] = await Promise.all([
        api.readGlobalPlugins(),
        api.detectPluginDuplicates(),
      ]);
      setPlugins(pluginList);
      setDuplicates(duplicateGroups);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to read plugins');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // Load once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggle = async (plugin: GlobalPlugin, checked: boolean): Promise<void> => {
    setActionError(null);
    setBusyId(plugin.id);
    try {
      await api.setPluginEnabled(plugin.id, checked);
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to update plugin');
    } finally {
      setBusyId(null);
    }
  };

  const handleKeep = async (group: DuplicateGroup, entry: GlobalPlugin): Promise<void> => {
    setActionError(null);
    setBusyId(entry.id);
    try {
      await api.dedupePlugin(group.name, entry.id);
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to dedupe plugin');
    } finally {
      setBusyId(null);
    }
  };

  if (loading && !plugins) {
    return (
      <div className="text-text-muted flex items-center gap-2 py-6 text-sm">
        <Loader2 className="size-4 animate-spin" />
        Loading plugins...
      </div>
    );
  }

  if (loadError && !plugins) {
    return (
      <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-xs">
        {loadError}
      </div>
    );
  }

  const rows = plugins ?? [];

  return (
    <div>
      <p className="text-text-muted text-xs">
        Disabling stops the CLI loading the plugin; installed files stay (disk isn&apos;t
        reclaimed here). Enabling a plugin activates any hooks or commands it ships, which run on
        CLI events.
      </p>

      {!canAct && (
        <p className="text-text-muted mt-2 text-xs">
          Plugins can only be toggled on this local machine.
        </p>
      )}

      {actionError && <p className="text-destructive mt-2 text-xs">{actionError}</p>}

      {duplicates.length > 0 && (
        <div className="mt-3 flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          {duplicates.map((group) => (
            <div key={group.name}>
              <p className="text-xs font-medium text-amber-500">
                {group.name} is enabled under multiple marketplaces:
              </p>
              <div className="mt-1 flex flex-col gap-1">
                {group.entries.map((entry) => (
                  <div key={entry.id} className="flex items-center gap-2">
                    <span className="border-border bg-surface text-text rounded-sm border px-1.5 py-0.5 font-mono text-xs">
                      {entry.marketplace}
                    </span>
                    <span className="text-text-muted font-mono text-xs">{entry.version}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      disabled={!canAct || busyId === entry.id}
                      onClick={() => void handleKeep(group, entry)}
                    >
                      Keep this one
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="border-border bg-surface-raised divide-border-subtle mt-2 divide-y rounded-md border">
        {rows.length === 0 && (
          <div className="text-text-muted px-3 py-2 text-xs">
            No plugins installed. Claude Code plugins are installed via the CLI; once installed
            they will appear here.
          </div>
        )}
        {rows.map((plugin) => (
          <div key={plugin.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-text text-sm font-medium">{plugin.name}</span>
                <span className="border-border bg-surface text-text-muted rounded-sm border px-1.5 py-0.5 font-mono text-xs">
                  {plugin.marketplace}
                </span>
              </div>
              <div className="text-text-muted mt-0.5 font-mono text-xs">{plugin.version}</div>
            </div>
            <Switch
              checked={plugin.enabled}
              disabled={!canAct || busyId === plugin.id}
              onCheckedChange={(checked) => void handleToggle(plugin, checked)}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
