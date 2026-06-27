

import type { Session } from './data';
import type { TriggerColor } from '@shared/constants/triggerColors';

// Navigation Request Types

export interface ErrorNavigationPayload {

  errorId: string;

  errorTimestamp: number;

  toolUseId?: string;

  subagentId?: string;

  lineNumber?: number;
}

export interface SearchNavigationPayload {

  query: string;

  messageTimestamp: number;

  matchedText: string;

  targetGroupId?: string;

  targetMatchIndexInItem?: number;

  targetMatchStartOffset?: number;

  targetMessageUuid?: string;
}

export interface TabNavigationRequest {

  id: string;

  kind: 'error' | 'search' | 'autoBottom';

  source: 'notification' | 'triggerPreview' | 'commandPalette' | 'sessionOpen';

  highlight: TriggerColor | 'yellow' | 'none';

  payload: ErrorNavigationPayload | SearchNavigationPayload | Record<string, never>;
}

// Core Types

export interface Tab {

  id: string;


  type:
    | 'session'
    | 'dashboard'
    | 'projects'
    | 'notifications'
    | 'settings'
    | 'comparison'
    | 'snapshot';


  sessionId?: string;


  projectId?: string;


  snapshotId?: string;


  compareSessionId?: string;
  compareProjectId?: string;


  extraCompareSessions?: { projectId: string; sessionId: string }[];


  label: string;


  createdAt: number;


  fromSearch?: boolean;


  pendingNavigation?: TabNavigationRequest;


  lastConsumedNavigationId?: string;


  savedScrollTop?: number;


  showContextPanel?: boolean;
}

export interface OpenTabOptions {

  forceNewTab?: boolean;

  replaceActiveTab?: boolean;
}

export type TabInput = Omit<Tab, 'id' | 'createdAt'>;

export type DateCategory = 'Today' | 'Yesterday' | 'Previous 7 Days' | 'Older';

export type DateGroupedSessions = Record<DateCategory, Session[]>;

// Constants

const TAB_LABEL_MAX_LENGTH = 50;

export const DATE_CATEGORY_ORDER: DateCategory[] = [
  'Today',
  'Yesterday',
  'Previous 7 Days',
  'Older',
];

// Validation Helpers

export function findTabBySession(tabs: Tab[], sessionId: string): Tab | undefined {
  return tabs.find((t) => t.type === 'session' && t.sessionId === sessionId);
}

export function findTabBySessionAndProject(
  tabs: Tab[],
  sessionId: string,
  projectId: string
): Tab | undefined {
  return tabs.find(
    (t) => t.type === 'session' && t.sessionId === sessionId && t.projectId === projectId
  );
}

export function truncateLabel(label: string): string {
  if (label.length <= TAB_LABEL_MAX_LENGTH) return label;
  return label.slice(0, TAB_LABEL_MAX_LENGTH - 1) + '…';
}

// Navigation Request Helpers

export function createErrorNavigationRequest(
  payload: ErrorNavigationPayload,
  source: 'notification' | 'triggerPreview' = 'notification',
  highlightColor?: TriggerColor
): TabNavigationRequest {
  return {
    id: crypto.randomUUID(),
    kind: 'error',
    source,
    highlight: highlightColor ?? 'red',
    payload,
  };
}

export function createSearchNavigationRequest(
  payload: SearchNavigationPayload
): TabNavigationRequest {
  return {
    id: crypto.randomUUID(),
    kind: 'search',
    source: 'commandPalette',
    highlight: 'yellow',
    payload,
  };
}

export function isErrorPayload(
  request: TabNavigationRequest
): request is TabNavigationRequest & { payload: ErrorNavigationPayload } {
  return request.kind === 'error';
}

export function isSearchPayload(
  request: TabNavigationRequest
): request is TabNavigationRequest & { payload: SearchNavigationPayload } {
  return request.kind === 'search';
}
