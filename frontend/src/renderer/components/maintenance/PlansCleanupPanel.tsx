import { JSX, useState } from 'react';
import { api } from '@renderer/api';
import { MarkdownViewer } from '@renderer/components/chat/viewers/MarkdownViewer';
import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { formatBytes } from '@renderer/utils/formatters';

import { CategoryCleanupPanel, type CategoryColumn } from './CategoryCleanupPanel';

import type { Candidate } from '@shared/types';

export const PlansCleanupPanel = (): JSX.Element => {
  const [viewing, setViewing] = useState<{ name: string; content: string } | null>(null);

  const openView = async (name: string): Promise<void> => {
    const content = await api.maintenance.readPlanFile(name);
    setViewing({ name, content });
  };

  const columns: CategoryColumn[] = [
    {
      key: 'name',
      label: 'Plan',
      render: (c: Candidate) => (
        <span className="text-foreground">
          {c.meta?.name ?? c.path.split('/').pop()}
          {c.meta?.stale === 'true' && (
            <span className="ml-2 rounded-sm bg-zinc-500/15 px-1 py-px text-[9px] font-medium text-zinc-400">
              stale
            </span>
          )}
        </span>
      ),
    },
    { key: 'bytes', label: 'Size', align: 'right', render: (c) => formatBytes(c.bytes) },
    { key: 'modTime', label: 'Last touched', render: (c) => c.modTime.toLocaleDateString() },
    {
      key: 'view',
      label: '',
      align: 'right',
      render: (c) => (
        <Button
          variant="ghost"
          size="sm"
          className="text-xs"
          onClick={() => void openView(c.meta?.name ?? '')}
        >
          View
        </Button>
      ),
    },
  ];

  return (
    <>
      <CategoryCleanupPanel
        title="Plans"
        description="Plan documents the CLI writes during plan mode and never cleans up. Stale is a badge, not a preselection — read before deleting. Variant siblings are grouped together."
        families={[{ id: 'plans', label: '', supportsCutoff: true }]}
        columns={columns}
        deletePolicy="trash"
      />

      {viewing && (
        <Dialog open onOpenChange={(open) => !open && setViewing(null)}>
          <DialogContent className="max-h-[80vh] overflow-hidden sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="truncate text-sm">{viewing.name}</DialogTitle>
            </DialogHeader>
            <MarkdownViewer content={viewing.content} maxHeight="60vh" copyable />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};
