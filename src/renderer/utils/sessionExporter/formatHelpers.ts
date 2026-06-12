/**
 * Internal formatting helpers for session export (numbers, cost, timestamps,
 * durations, truncation). Consumed by the plain-text and Markdown exporters.
 */

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

export function formatCost(cost?: number): string {
  if (cost == null) return 'N/A';
  return `$${cost.toFixed(2)}`;
}

export function formatTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, ' UTC');
}

export function formatDurationForExport(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${remainSecs}s`;
}

export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}
