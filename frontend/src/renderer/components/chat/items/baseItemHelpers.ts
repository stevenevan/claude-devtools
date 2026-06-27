

import { formatTokens } from '@shared/utils/tokenFormatting';

import type { ItemStatus } from './BaseItem';

// Re-export for backwards compatibility
export { formatTokens };

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '...';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function getStatusDotClass(status: ItemStatus): string {
  const classes: Record<ItemStatus, string> = {
    ok: 'bg-green-500',
    error: 'bg-red-500',
    pending: 'bg-yellow-500',
    orphaned: 'bg-muted-foreground',
  };
  return classes[status];
}
