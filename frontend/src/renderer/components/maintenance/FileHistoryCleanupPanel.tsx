import { JSX } from 'react';
import { formatBytes } from '@renderer/utils/formatters';

import { CategoryCleanupPanel, type CategoryColumn } from './CategoryCleanupPanel';

import type { Candidate } from '@shared/types';

const GROUP_LABELS: Record<string, string> = {
  empty: 'Empty dirs',
  stale: 'Stale history',
};

const COLUMNS: CategoryColumn[] = [
  {
    key: 'uuid',
    label: 'UUID',
    render: (c: Candidate) => (
      <span className="text-foreground">{c.meta?.uuid ?? c.path.split('/').pop()}</span>
    ),
  },
  { key: 'files', label: 'Snapshots', align: 'right', render: (c) => c.files },
  { key: 'bytes', label: 'Size', align: 'right', render: (c) => formatBytes(c.bytes) },
  { key: 'modTime', label: 'Last used', render: (c) => c.modTime.toLocaleDateString() },
];

export const FileHistoryCleanupPanel = (): JSX.Element => (
  <CategoryCleanupPanel
    title="File-history retention"
    description="The CLI's edit-undo store: per-file snapshots under file-history/ used to restore earlier versions during a session. Removing an old entry only drops the ability to restore those old file versions — it does not touch the file's current content."
    families={[{ id: 'file-history', label: '', supportsCutoff: true }]}
    columns={COLUMNS}
    deletePolicy="trash"
    groupLabel={(g) => GROUP_LABELS[g] ?? g}
  />
);
