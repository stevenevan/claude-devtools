import { formatDistance } from 'date-fns';

import { conversationSubjectKey } from '@renderer/hooks/useConversationSubjects';
import { sanitizeSimpleText } from '@renderer/utils/simpleTextSanitizer';

import type { ConversationSubjectLookup } from '@renderer/hooks/useConversationSubjects';
import type { DetectedError } from '@renderer/types/data';

export interface AlertTarget {
  projectId: string;
  sessionId: string;
}

export interface SimpleAlertPresentation {
  source: string;
  message: string;
  relativeTime: string;
  conversationSubject: string;
  target: AlertTarget | null;
  dateTime: string | null;
}

export type SimpleAlertEmptyState = 'no-records' | 'no-enabled-triggers';

const FALLBACK_CONVERSATION_SUBJECT = 'Untitled conversation';
const FALLBACK_ALERT_SOURCE = 'Alert';
const FALLBACK_ALERT_MESSAGE = 'No message available';
const FALLBACK_SYSTEM_SUBJECT = 'System alert';

declare global {
  interface Array<T> {
    toSorted(compareFn?: (left: T, right: T) => number): T[];
  }

  interface ReadonlyArray<T> {
    toSorted(compareFn?: (left: T, right: T) => number): T[];
  }
}

function getSafeTimestamp(timestamp: number): number {
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function getSafeCreatedAt(createdAt: number): number {
  return Number.isFinite(createdAt) ? createdAt : Number.NEGATIVE_INFINITY;
}

function getSafeText(value: string | undefined, fallback: string): string {
  const text = sanitizeSimpleText(value?.trim() ?? '').trim();
  return text || fallback;
}

function humanizeSource(source: string): string {
  const text = getSafeText(source, FALLBACK_ALERT_SOURCE)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? `${text[0]?.toUpperCase() ?? ''}${text.slice(1)}` : FALLBACK_ALERT_SOURCE;
}

export function getAlertTarget(
  alert: Pick<DetectedError, 'projectId' | 'sessionId'>
): AlertTarget | null {
  const projectId = alert.projectId.trim();
  const sessionId = alert.sessionId.trim();
  if (!projectId || !sessionId) return null;
  return { projectId, sessionId };
}

export function orderAlerts(alerts: readonly DetectedError[]): DetectedError[] {
  return alerts.toSorted((left, right) => {
    const rightTimestamp = getSafeTimestamp(right.timestamp);
    const leftTimestamp = getSafeTimestamp(left.timestamp);
    if (rightTimestamp > leftTimestamp) return 1;
    if (rightTimestamp < leftTimestamp) return -1;

    const rightCreatedAt = getSafeCreatedAt(right.createdAt);
    const leftCreatedAt = getSafeCreatedAt(left.createdAt);
    if (rightCreatedAt > leftCreatedAt) return 1;
    if (rightCreatedAt < leftCreatedAt) return -1;

    return left.id.localeCompare(right.id);
  });
}

export function formatAlertRelativeTime(timestamp: number, now = Date.now()): string {
  if (!Number.isFinite(timestamp) || !Number.isFinite(now)) return 'Time unavailable';

  const alertDate = new Date(timestamp);
  const nowDate = new Date(now);
  if (Number.isNaN(alertDate.getTime()) || Number.isNaN(nowDate.getTime())) {
    return 'Time unavailable';
  }

  return formatDistance(alertDate, nowDate, { addSuffix: true });
}

export function getAlertConversationLabel(
  alert: DetectedError,
  conversationSubjects: ConversationSubjectLookup
): string {
  const identity = getAlertTarget(alert);
  const resolvedSubject = identity
    ? conversationSubjects.get(conversationSubjectKey(identity))
    : undefined;
  const subject = getSafeText(resolvedSubject, '');
  if (subject && subject !== FALLBACK_CONVERSATION_SUBJECT) return subject;

  const projectName = getSafeText(alert.context?.projectName, '');
  if (projectName) return projectName;
  return identity ? FALLBACK_CONVERSATION_SUBJECT : FALLBACK_SYSTEM_SUBJECT;
}

export function presentSimpleAlert(
  alert: DetectedError,
  conversationSubjects: ConversationSubjectLookup,
  now = Date.now()
): SimpleAlertPresentation {
  const date = Number.isFinite(alert.timestamp) ? new Date(alert.timestamp) : null;
  const dateTime = date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;

  return {
    source: humanizeSource(alert.triggerName ?? alert.source),
    message: getSafeText(alert.message, FALLBACK_ALERT_MESSAGE),
    relativeTime: formatAlertRelativeTime(alert.timestamp, now),
    conversationSubject: getAlertConversationLabel(alert, conversationSubjects),
    target: getAlertTarget(alert),
    dateTime,
  };
}

export function getSimpleAlertEmptyState(
  alerts: readonly DetectedError[],
  hasEnabledTriggers: boolean
): SimpleAlertEmptyState | null {
  if (alerts.length > 0) return null;
  return hasEnabledTriggers ? 'no-records' : 'no-enabled-triggers';
}
