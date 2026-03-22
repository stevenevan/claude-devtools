/**
 * Helper functions for BaseItem component.
 * Extracted to a separate file to comply with react-refresh/only-export-components.
 */

import { formatTokens } from '@shared/utils/tokenFormatting';

import type { ItemStatus } from './BaseItem';

// Re-export for backwards compatibility
export { formatTokens };

/**
 * Formats duration in milliseconds to a human-readable string.
 */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '...';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Truncates text to a maximum length with ellipsis.
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

/**
 * Get Tailwind background class for status dot.
 */
export function getStatusDotClass(status: ItemStatus): string {
  const classes: Record<ItemStatus, string> = {
    ok: 'bg-green-500',
    error: 'bg-red-500',
    pending: 'bg-yellow-500',
    orphaned: 'bg-muted-foreground',
  };
  return classes[status];
}
