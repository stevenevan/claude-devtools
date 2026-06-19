import type { TriggerColor } from '@shared/constants/triggerColors';

/**
 * Detected error from session JSONL files.
 * Used for notification display and deep linking to error locations.
 */
export interface DetectedError {
  /** UUID for unique identification */
  id: string;
  /** Unix timestamp when error occurred */
  timestamp: number;
  /** Session ID where error occurred */
  sessionId: string;
  /** Project ID (encoded project path) */
  projectId: string;
  /** Path to the JSONL file */
  filePath: string;
  /** Tool name or 'assistant' */
  source: string;
  /** Error message text */
  message: string;
  /** Line number in JSONL for deep linking */
  lineNumber?: number;
  /** Tool use ID for precise deep linking to the specific tool item */
  toolUseId?: string;
  /** Subagent ID when error originates from a subagent session */
  subagentId?: string;
  /** Whether the notification has been read */
  isRead: boolean;
  /** When the notification was created */
  createdAt: number;
  /** Trigger color key for notification dot and highlight */
  triggerColor?: TriggerColor;
  /** ID of the trigger that produced this notification */
  triggerId?: string;
  /** Human-readable name of the trigger that produced this notification */
  triggerName?: string;
  /** Additional context */
  context: {
    /** Display name of the project */
    projectName: string;
    /** Current working directory when error occurred */
    cwd?: string;
  };
}
