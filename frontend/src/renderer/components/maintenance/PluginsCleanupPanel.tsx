import { JSX } from 'react';
import { formatBytes } from '@renderer/utils/formatters';

import { CategoryCleanupPanel, type CategoryColumn } from './CategoryCleanupPanel';

import type { Candidate } from '@shared/types';

const GROUP_LABELS: Record<string, string> = {
  cache: 'Cached plugin repos',
  marketplaces: 'Marketplaces',
  repos: 'Downloaded repos',
};

function itemName(c: Candidate): string {
  if (c.meta?.plugin) return `${c.meta.marketplace}/${c.meta.plugin}`;
  return c.meta?.name ?? c.path.split('/').pop() ?? c.path;
}

const COLUMNS: CategoryColumn[] = [
  {
    key: 'name',
    label: 'Item',
    render: (c) => (
      <span className="text-foreground">
        {itemName(c)}
        {c.meta?.enabled === 'true' && (
          <span className="ml-2 rounded-sm bg-amber-500/15 px-1 py-px text-[9px] font-medium text-amber-500">
            enabled — re-downloads
          </span>
        )}
        {c.meta?.layoutAnomaly === 'repos-empty' && (
          <span className="ml-2 rounded-sm bg-sky-500/15 px-1 py-px text-[9px] font-medium text-sky-400">
            repos/ empty
          </span>
        )}
      </span>
    ),
  },
  { key: 'reason', label: 'Status', render: (c) => c.reason },
  { key: 'bytes', label: 'Size', align: 'right', render: (c) => formatBytes(c.bytes) },
];

export const PluginsCleanupPanel = (): JSX.Element => (
  <CategoryCleanupPanel
    title="Plugin cache"
    description="Cached plugin repos, marketplace metadata, and downloaded repos under plugins/. Removing a disabled plugin's cache reclaims space safely; an enabled plugin re-downloads on next use."
    families={[{ id: 'plugins', label: '', supportsCutoff: false }]}
    columns={COLUMNS}
    deletePolicy="trash"
    groupLabel={(g) => GROUP_LABELS[g] ?? g}
  />
);
