import { JSX } from 'react';
import { formatBytes } from '@renderer/utils/formatters';

import { CategoryCleanupPanel, type CategoryColumn } from './CategoryCleanupPanel';

import type { Candidate } from '@shared/types';

// "2026-03" → "March 2026". Falls back to the raw key on a parse miss.
export function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  if (!year || !month) return key;
  return new Date(year, month - 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

const COLUMNS: CategoryColumn[] = [
  {
    key: 'name',
    label: 'File',
    render: (c: Candidate) => <span className="text-foreground">{c.path.split('/').pop()}</span>,
  },
  { key: 'bytes', label: 'Size', align: 'right', render: (c) => formatBytes(c.bytes) },
  { key: 'modTime', label: 'Last written', render: (c) => c.modTime.toLocaleDateString() },
];

export const TranscriptsCleanupPanel = (): JSX.Element => (
  <CategoryCleanupPanel
    title="Stale transcripts"
    description="Machine-generated conversation logs under transcripts/ the CLI never prunes. Files older than the cutoff, bucketed by month. Transcripts are conversation content — the permanent-delete path erases them instead of keeping a restorable copy."
    families={[{ id: 'transcripts', label: '', supportsCutoff: true }]}
    columns={COLUMNS}
    deletePolicy="trash+permanent"
    groupLabel={monthLabel}
  />
);
