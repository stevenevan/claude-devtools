/**
 * NotificationsSection - Notification settings including triggers and ignored repositories.
 */

import {
  RepositoryDropdown,
  SelectedRepositoryItem,
} from '@renderer/components/common/RepositoryDropdown';
import { cn } from '@renderer/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';
import { Switch } from '@renderer/components/ui/switch';

import { SettingRow, SettingsSectionHeader } from '../components';
import { NotificationTriggerSettings } from '../NotificationTriggerSettings';

import type { RepositoryDropdownItem, SafeConfig } from '../hooks/useSettingsConfig';
import type { NotificationTrigger } from '@renderer/types/data';

// Snooze duration options
const SNOOZE_OPTIONS = [
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 240, label: '4 hours' },
  { value: -1, label: 'Until tomorrow' },
] as const;

interface NotificationsSectionProps {
  readonly safeConfig: SafeConfig;
  readonly saving: boolean;
  readonly isSnoozed: boolean;
  readonly ignoredRepositoryItems: RepositoryDropdownItem[];
  readonly excludedRepositoryIds: string[];
  readonly onNotificationToggle: (
    key: 'enabled' | 'soundEnabled' | 'includeSubagentErrors',
    value: boolean
  ) => void;
  readonly onSnooze: (minutes: number) => Promise<void>;
  readonly onClearSnooze: () => Promise<void>;
  readonly onAddIgnoredRepository: (item: RepositoryDropdownItem) => Promise<void>;
  readonly onRemoveIgnoredRepository: (repositoryId: string) => Promise<void>;
  readonly onAddTrigger: (trigger: Omit<NotificationTrigger, 'isBuiltin'>) => Promise<void>;
  readonly onUpdateTrigger: (
    triggerId: string,
    updates: Partial<NotificationTrigger>
  ) => Promise<void>;
  readonly onRemoveTrigger: (triggerId: string) => Promise<void>;
}

export const NotificationsSection = ({
  safeConfig,
  saving,
  isSnoozed,
  ignoredRepositoryItems,
  excludedRepositoryIds,
  onNotificationToggle,
  onSnooze,
  onClearSnooze,
  onAddIgnoredRepository,
  onRemoveIgnoredRepository,
  onAddTrigger,
  onUpdateTrigger,
  onRemoveTrigger,
}: NotificationsSectionProps): React.JSX.Element => {
  return (
    <div>
      {/* Notification Triggers */}
      <NotificationTriggerSettings
        triggers={safeConfig.notifications.triggers || []}
        saving={saving}
        onUpdateTrigger={onUpdateTrigger}
        onAddTrigger={onAddTrigger}
        onRemoveTrigger={onRemoveTrigger}
      />

      {/* Notification Settings */}
      <SettingsSectionHeader title="Notification Settings" />
      <SettingRow
        label="Enable System Notifications"
        description="Show system notifications for errors and events"
      >
        <Switch
          checked={safeConfig.notifications.enabled}
          onCheckedChange={(v) => onNotificationToggle('enabled', v)}
          disabled={saving}
        />
      </SettingRow>
      <SettingRow label="Play sound" description="Play a sound when notifications appear">
        <Switch
          checked={safeConfig.notifications.soundEnabled}
          onCheckedChange={(v) => onNotificationToggle('soundEnabled', v)}
          disabled={saving || !safeConfig.notifications.enabled}
        />
      </SettingRow>
      <SettingRow
        label="Include subagent errors"
        description="Detect and notify about errors in subagent sessions"
      >
        <Switch
          checked={safeConfig.notifications.includeSubagentErrors}
          onCheckedChange={(v) => onNotificationToggle('includeSubagentErrors', v)}
          disabled={saving || !safeConfig.notifications.enabled}
        />
      </SettingRow>
      <SettingRow
        label="Snooze notifications"
        description={
          isSnoozed
            ? `Snoozed until ${new Date(safeConfig.notifications.snoozedUntil!).toLocaleTimeString()}`
            : 'Temporarily pause notifications'
        }
      >
        <div className="flex items-center gap-2">
          {isSnoozed ? (
            <button
              onClick={onClearSnooze}
              disabled={saving}
              className={cn('rounded-md bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-400 transition-all duration-150 hover:bg-red-500/20', saving && 'cursor-not-allowed opacity-50')}
            >
              Clear Snooze
            </button>
          ) : (
            <Select
              value="0"
              onValueChange={(v) => {
                const n = Number(v);
                if (n !== 0) void onSnooze(n);
              }}
              disabled={saving || !safeConfig.notifications.enabled}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent side="top">
                <SelectItem value="0">Select duration...</SelectItem>
                {SNOOZE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </SettingRow>

      <SettingsSectionHeader title="Ignored Repositories" />
      <p className="text-text-muted mb-3 text-xs">
        Notifications from these repositories will be ignored
      </p>
      {ignoredRepositoryItems.length > 0 ? (
        <div className="mb-3">
          {ignoredRepositoryItems.map((item) => (
            <SelectedRepositoryItem
              key={item.id}
              item={item}
              onRemove={() => onRemoveIgnoredRepository(item.id)}
              disabled={saving}
            />
          ))}
        </div>
      ) : (
        <div className="border-border mb-3 rounded-md border border-dashed py-3 text-center">
          <p className="text-text-muted text-sm">No repositories ignored</p>
        </div>
      )}
      <RepositoryDropdown
        onSelect={onAddIgnoredRepository}
        excludeIds={excludedRepositoryIds}
        placeholder="Select repository to ignore..."
        disabled={saving}
        dropUp
      />
    </div>
  );
};
