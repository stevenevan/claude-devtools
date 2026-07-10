import { Dispatch, SetStateAction } from 'react';
import type { RepositoryDropdownItem } from '../useSettingsConfig';
import type { AppConfig, NotificationTrigger } from '@renderer/types/data';

export interface UseSettingsHandlersProps {
  config: AppConfig | null;
  setSaving: (saving: boolean) => void;
  setError: (error: string | null) => void;
  setConfig: (config: AppConfig | null) => void;
  setOptimisticConfig: Dispatch<SetStateAction<AppConfig | null>>;
  updateConfig: (
    section: keyof AppConfig,
    data: Partial<AppConfig[keyof AppConfig]>
  ) => Promise<void>;
}

export interface SettingsHandlers {
  // General handlers
  handleGeneralToggle: (key: keyof AppConfig['general'], value: boolean) => void;
  handleThemeChange: (value: 'dark' | 'light' | 'system') => void;
  handleDefaultTabChange: (value: 'dashboard' | 'last-session') => void;

  // Notification handlers
  handleNotificationToggle: (key: keyof AppConfig['notifications'], value: boolean) => void;
  handleSnooze: (minutes: number) => Promise<void>;
  handleClearSnooze: () => Promise<void>;
  handleAddIgnoredRepository: (item: RepositoryDropdownItem) => Promise<void>;
  handleRemoveIgnoredRepository: (repositoryId: string) => Promise<void>;
  handleSetNotificationPolicy: (retentionDays: number, maxCount: number) => Promise<void>;

  // Trigger handlers
  handleAddTrigger: (trigger: Omit<NotificationTrigger, 'isBuiltin'>) => Promise<void>;
  handleUpdateTrigger: (triggerId: string, updates: Partial<NotificationTrigger>) => Promise<void>;
  handleRemoveTrigger: (triggerId: string) => Promise<void>;

  // Display handlers
  handleDisplayToggle: (key: keyof AppConfig['display'], value: boolean) => void;
  handleCodeBlockThemeChange: (value: string) => void;

  // Advanced handlers
  handleResetToDefaults: () => Promise<void>;
  handleExportConfig: () => void;
  handleImportConfig: () => void;
  handleOpenInEditor: () => Promise<void>;
}
