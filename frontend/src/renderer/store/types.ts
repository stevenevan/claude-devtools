import type { AnnotationSlice } from './slices/annotationSlice';
import type { ClaudeConfigSlice } from './slices/claudeConfigSlice';
import type { ComparisonTabSlice } from './slices/comparisonTabSlice';
import type { ConfigSlice } from './slices/configSlice';
import type { ConnectionSlice } from './slices/connectionSlice';
import type { ContextSlice } from './slices/contextSlice';
import type { ConversationSlice } from './slices/conversation';
import type { ConversationFeedSlice } from './slices/conversationFeedSlice';
import type { MaintenanceSlice } from './slices/maintenanceSlice';
import type { InspectorSourceSlice } from './slices/inspectorSourceSlice';
import type { NotificationSlice } from './slices/notificationSlice';
import type { PaneSlice } from './slices/paneSlice';
import type { ProjectContextSlice } from './slices/projectContextSlice';
import type { ProjectSlice } from './slices/projectSlice';
import type { ReplaySlice } from './slices/replaySlice';
import type { RepositorySlice } from './slices/repositorySlice';
import type { SessionDetailSlice } from './slices/sessionDetailSlice';
import type { SessionSlice } from './slices/sessionSlice';
import type { SnapshotSlice } from './slices/snapshotSlice';
import type { SubagentSlice } from './slices/subagentSlice';
import type { TabSlice } from './slices/tabSlice';
import type { TabUISlice } from './slices/tabUISlice';
import type { UISlice } from './slices/uiSlice';
import type { UpdateSlice } from './slices/updateSlice';

export interface BreadcrumbItem {
  id: string;
  description: string;
}

export interface SearchMatch {

  itemId: string;

  itemType: 'user' | 'ai';

  matchIndexInItem: number;

  globalIndex: number;

  displayItemId?: string;
}

export interface SearchNavigationContext {

  query: string;

  messageTimestamp: number;

  matchedText: string;

  targetGroupId?: string;

  targetMatchIndexInItem?: number;

  targetMatchStartOffset?: number;

  targetMessageUuid?: string;
}

export type AppState = ProjectSlice &
  RepositorySlice &
  SessionSlice &
  SessionDetailSlice &
  SubagentSlice &
  ConversationSlice &
  ConversationFeedSlice &
  TabSlice &
  TabUISlice &
  PaneSlice &
  ProjectContextSlice &
  UISlice &
  NotificationSlice &
  ConfigSlice &
  ClaudeConfigSlice &
  ConnectionSlice &
  ContextSlice &
  UpdateSlice &
  AnnotationSlice &
  ReplaySlice &
  ComparisonTabSlice &
  SnapshotSlice &
  MaintenanceSlice &
  InspectorSourceSlice;
