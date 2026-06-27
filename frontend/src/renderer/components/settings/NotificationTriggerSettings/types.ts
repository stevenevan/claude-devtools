import { ComponentType } from 'react';
import type { NotificationTrigger, TriggerMode, TriggerTestResult } from '@renderer/types/data';

export interface PreviewResult {
  loading: boolean;
  totalCount: number;
  errors: TriggerTestResult['errors'];
  // True if results were truncated due to safety limits (totalCount may be capped at 10,000).
  truncated?: boolean;
}

export interface ModeConfig {
  value: TriggerMode;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export interface NotificationTriggerSettingsProps {
  triggers: NotificationTrigger[];
  saving: boolean;
  onUpdateTrigger: (triggerId: string, updates: Partial<NotificationTrigger>) => Promise<void>;
  onAddTrigger: (trigger: Omit<NotificationTrigger, 'isBuiltin'>) => Promise<void>;
  onRemoveTrigger: (triggerId: string) => Promise<void>;
}
