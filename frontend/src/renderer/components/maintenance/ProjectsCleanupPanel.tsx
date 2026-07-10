import { JSX } from 'react';
import { formatBytes } from '@renderer/utils/formatters';

import { CategoryCleanupPanel, type CategoryColumn } from './CategoryCleanupPanel';

import type { Candidate } from '@shared/types';

const COLUMNS: CategoryColumn[] = [
  {
    key: 'session',
    label: 'Session',
    render: (c: Candidate) => (
      <span className="text-foreground">
        {c.meta?.sessionId ?? c.path.split('/').pop()}
        {c.meta?.pinned === 'true' && (
          <span className="ml-2 rounded-sm bg-amber-500/15 px-1 py-px text-[9px] font-medium text-amber-500">
            pinned
          </span>
        )}
      </span>
    ),
  },
  { key: 'bytes', label: 'Size', align: 'right', render: (c) => formatBytes(c.bytes) },
  { key: 'modTime', label: 'Last modified', render: (c) => c.modTime.toLocaleDateString() },
  {
    key: 'encoded',
    label: 'Encoded dir',
    render: (c) => <span className="text-muted-foreground/70">{c.meta?.encoded}</span>,
  },
];

export const ProjectsCleanupPanel = (): JSX.Element => (
  <CategoryCleanupPanel
    title="Projects"
    description="Session JSONL under projects/ — the app's own conversation-log input, grouped by decoded project path. Sessions are full conversation content and may contain secrets; trashed copies persist until the trash is emptied. The raw encoded directory is shown per row since hyphenated repo names can decode ambiguously. Pinned sessions are excluded from bulk selection."
    families={[{ id: 'projects', label: '', supportsCutoff: true }]}
    columns={COLUMNS}
    deletePolicy="trash+permanent"
    excludeFromBulk={(c) => c.meta?.pinned === 'true'}
  />
);
