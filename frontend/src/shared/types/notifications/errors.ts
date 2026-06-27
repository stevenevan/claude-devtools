import type { TriggerColor } from '@shared/constants/triggerColors';

export interface DetectedError {

  id: string;

  timestamp: number;

  sessionId: string;

  projectId: string;

  filePath: string;

  source: string;

  message: string;

  lineNumber?: number;

  toolUseId?: string;

  subagentId?: string;

  isRead: boolean;

  createdAt: number;

  triggerColor?: TriggerColor;

  triggerId?: string;

  triggerName?: string;

  context: {

    projectName: string;

    cwd?: string;
  };
}
