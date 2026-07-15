import { JSX } from 'react';
import { formatBytes } from '@renderer/utils/formatters';

import { CategoryCleanupPanel, type CategoryColumn } from './CategoryCleanupPanel';

import type { Candidate } from '@shared/types';

const COLUMNS: CategoryColumn[] = [
  {
    key: 'path',
    label: 'Path',
    render: (c: Candidate) => <span className="text-foreground">{c.path.split('/').pop()}</span>,
  },
  { key: 'bytes', label: 'Size', align: 'right', render: (c) => formatBytes(c.bytes) },
];

export const JunkCleanupPanel = (): JSX.Element => (
  <CategoryCleanupPanel
    title="Junk sweep"
    description="Zero-value clutter: macOS .DS_Store files, leftover *.tmp files from interrupted writes, and empty directories. Each family is independently toggleable; all are trivially regenerable or worthless."
    families={[
      { id: 'junk-dsstore', label: 'macOS files (.DS_Store)', supportsCutoff: false },
      { id: 'junk-tmp', label: 'Stale temp files (*.tmp)', supportsCutoff: true },
      { id: 'junk-emptydirs', label: 'Empty directories', supportsCutoff: false },
    ]}
    columns={COLUMNS}
    deletePolicy="trash"
    groupLabel={(g) => g}
  />
);
