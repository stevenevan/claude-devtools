import { JSX } from 'react';
import { formatBytes } from '@renderer/utils/formatters';

import { CategoryCleanupPanel, type CategoryColumn, type CategoryFamily } from './CategoryCleanupPanel';

import type { Candidate } from '@shared/types';

const FAMILIES: CategoryFamily[] = [
  {
    id: 'runtime-tasks',
    label: 'Task state',
    description: 'Per-session task dirs holding real (if dead) state alongside .lock/.highwatermark markers.',
    supportsCutoff: true,
  },
  {
    id: 'runtime-tasks-empty',
    label: 'Empty task markers',
    description: 'Task dirs with nothing left but the CLI own .lock/.highwatermark bookkeeping files.',
    supportsCutoff: true,
  },
  {
    id: 'runtime-jobs',
    label: 'Jobs',
    description: 'Background job records under jobs/. pins.json (user pin state) is always protected.',
    supportsCutoff: true,
  },
  {
    id: 'runtime-sessions',
    label: 'Sessions',
    description: 'Per-session runtime state left behind under sessions/ after a session ends.',
    supportsCutoff: true,
  },
  {
    id: 'runtime-session-env',
    label: 'Session environments',
    description: 'Captured shell environment snapshots under session-env/ from past sessions.',
    supportsCutoff: true,
  },
  {
    id: 'runtime-shell-snapshots',
    label: 'Shell snapshots',
    description: 'Point-in-time shell state under shell-snapshots/ from past sessions.',
    supportsCutoff: true,
  },
];

const COLUMNS: CategoryColumn[] = [
  {
    key: 'name',
    label: 'Name',
    render: (c: Candidate) => <span className="text-foreground">{c.path.split('/').pop()}</span>,
  },
  { key: 'bytes', label: 'Size', align: 'right', render: (c) => formatBytes(c.bytes) },
  { key: 'modTime', label: 'Last used', render: (c) => c.modTime.toLocaleDateString() },
];

export const RuntimeCleanupPanel = (): JSX.Element => (
  <CategoryCleanupPanel
    title="Runtime-state GC"
    description="Per-session runtime droppings the CLI never cleans up on its own: task markers, jobs, sessions, session environments, and shell snapshots. Individually tiny, collectively permanent clutter with no cleanup path anywhere else."
    families={FAMILIES}
    columns={COLUMNS}
    deletePolicy="trash"
    groupLabel={(g) => g}
  />
);
