import { formatDistanceToNowStrict } from 'date-fns';

import type { GlobalSession } from '@shared/types';

export function formatConversationSubject(session: GlobalSession): string {
  return session.customTitle ?? session.firstMessage ?? 'Untitled conversation';
}

export function formatConversationTime(createdAt: number): string {
  return formatDistanceToNowStrict(new Date(createdAt), { addSuffix: true });
}

export function formatConversationMessageCount(messageCount: number): string {
  return `${messageCount} ${messageCount === 1 ? 'message' : 'messages'}`;
}

export function formatApproximateConversationCost(costUsd?: number): string {
  return costUsd == null ? 'Cost unavailable' : `about ${formatCost(costUsd)}`;
}

export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m`;
  const h = Math.floor(ms / 3600_000);
  const m = Math.round((ms % 3600_000) / 60_000);
  return `${h}h ${m}m`;
}

export function formatCost(usd: number): string {
  if (usd >= 100) return `$${usd.toFixed(0)}`;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}
