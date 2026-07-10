import { JSX } from 'react';
import { formatBytes } from '@renderer/utils/formatters';

import { CategoryCleanupPanel, type CategoryColumn, type CategoryFamily } from './CategoryCleanupPanel';

import type { Candidate } from '@shared/types';

const COLUMNS: CategoryColumn[] = [
  {
    key: 'name',
    label: 'File',
    render: (c: Candidate) => <span className="text-foreground">{c.path.split('/').pop()}</span>,
  },
  { key: 'bytes', label: 'Size', align: 'right', render: (c) => formatBytes(c.bytes) },
  { key: 'modTime', label: 'Last write', render: (c) => c.modTime.toLocaleString() },
];

const FAMILIES: CategoryFamily[] = [
  { id: 'logs', label: 'App logs (devtools)' },
  { id: 'logs-daemon', label: 'CLI daemon log', truncate: true },
];

export const LogsCleanupPanel = (): JSX.Element => (
  <CategoryCleanupPanel
    title="Logs"
    description="Devtools app logs and the CLI daemon log — regenerable diagnostics, cleared immediately (plain delete, not moved to trash). The daemon log is truncated in place rather than unlinked, so a daemon holding the file keeps writing to it instead of an orphaned inode."
    families={FAMILIES}
    columns={COLUMNS}
    deletePolicy="plain"
  />
);
