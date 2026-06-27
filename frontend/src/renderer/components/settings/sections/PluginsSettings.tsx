import { JSX, useEffect, useState } from 'react';
import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { useStore } from '@renderer/store';
import { createLogger } from '@shared/utils/logger';
import { Plug, RotateCw } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { PluginEntry } from '@shared/types/api';

const logger = createLogger('PluginsSettings');

const EMPTY_ARRAY: never[] = [];

export const PluginsSettings = (): JSX.Element => {
  const { enabledIds, setPluginEnabled } = useStore(
    useShallow((s) => ({
      enabledIds: s.appConfig?.plugins?.enabled ?? EMPTY_ARRAY,
      setPluginEnabled: s.setPluginEnabled,
    }))
  );
  const [discovered, setDiscovered] = useState<PluginEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.plugins.list();
      setDiscovered(list);
    } catch (err) {
      logger.error('plugin discovery failed', err);
      setError(err instanceof Error ? err.message : 'Discovery failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const enabledSet = new Set(enabledIds);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-text inline-flex items-center gap-2 text-base font-semibold">
            <Plug className="size-4" />
            Plugins
          </h2>
          <p className="text-text-muted mt-1 text-xs">
            Plugins discovered in <code>~/.claude-devtools/plugins/</code>. Enable a plugin to load
            it into a sandboxed Web Worker. Allowed APIs: registerPanel, registerCommand,
            registerContextMenuItem, subscribeStoreSlice (max 5 concurrent, 64KB payload).
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refresh()}
          disabled={loading}
          className="gap-1"
        >
          <RotateCw className="size-3" />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-xs">
          {error}
        </div>
      )}

      {!loading && discovered.length === 0 && (
        <p className="text-text-muted text-xs">
          No plugins found. Drop a <code>.js</code> file into the plugins folder and click Refresh.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {discovered.map((plugin) => {
          const enabled = enabledSet.has(plugin.id);
          return (
            <li
              key={plugin.id}
              className="border-border bg-surface-raised flex items-center justify-between gap-3 rounded-md border px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="text-text text-sm font-medium">{plugin.id}</div>
                <div className="text-text-muted truncate font-mono text-[10px]">{plugin.path}</div>
              </div>
              <Button
                variant={enabled ? 'outline' : 'secondary'}
                size="sm"
                onClick={() => void setPluginEnabled(plugin.id, !enabled)}
              >
                {enabled ? 'Disable' : 'Enable'}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
