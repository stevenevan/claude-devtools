import type { SettingsSection } from './SettingsTabs';

export interface SettingsSearchItem {
  readonly id: string;
  readonly label: string;
  readonly section: SettingsSection;
  readonly sectionLabel: string;
  readonly anchorId: string;
  readonly desktopOnly?: boolean;
}

export const SETTINGS_SEARCH_ITEMS: readonly SettingsSearchItem[] = [
  {
    id: 'interface-mode',
    label: 'Interface mode',
    section: 'general',
    sectionLabel: 'General',
    anchorId: 'settings-interface-mode',
  },
  {
    id: 'launch-at-login',
    label: 'Launch at login',
    section: 'general',
    sectionLabel: 'General',
    anchorId: 'settings-launch-at-login',
    desktopOnly: true,
  },
  {
    id: 'theme',
    label: 'Theme',
    section: 'general',
    sectionLabel: 'General',
    anchorId: 'settings-theme',
  },
  {
    id: 'expand-ai-responses',
    label: 'Expand AI responses',
    section: 'general',
    sectionLabel: 'General',
    anchorId: 'settings-expand-ai-responses',
  },
  {
    id: 'code-block-theme',
    label: 'Code block theme',
    section: 'general',
    sectionLabel: 'General',
    anchorId: 'settings-code-block-theme',
  },
  {
    id: 'show-line-numbers',
    label: 'Show line numbers',
    section: 'general',
    sectionLabel: 'General',
    anchorId: 'settings-show-line-numbers',
  },
  {
    id: 'word-wrap',
    label: 'Word wrap',
    section: 'general',
    sectionLabel: 'General',
    anchorId: 'settings-word-wrap',
  },
  {
    id: 'claude-root',
    label: 'Claude data folder',
    section: 'general',
    sectionLabel: 'General',
    anchorId: 'settings-claude-root',
    desktopOnly: true,
  },
  {
    id: 'remote-connection',
    label: 'Remote connection',
    section: 'connection',
    sectionLabel: 'Connection',
    anchorId: 'settings-remote-connection',
    desktopOnly: true,
  },
  {
    id: 'workspace-profiles',
    label: 'Workspace profiles',
    section: 'workspace',
    sectionLabel: 'Workspaces',
    anchorId: 'settings-workspace-profiles',
    desktopOnly: true,
  },
  {
    id: 'environment-variables',
    label: 'Environment variables',
    section: 'claudeCode',
    sectionLabel: 'Claude Code',
    anchorId: 'settings-environment-variables',
    desktopOnly: true,
  },
  {
    id: 'permissions',
    label: 'Permissions',
    section: 'claudeCode',
    sectionLabel: 'Claude Code',
    anchorId: 'settings-permissions',
    desktopOnly: true,
  },
  {
    id: 'notification-settings',
    label: 'Notification settings',
    section: 'notifications',
    sectionLabel: 'Notifications',
    anchorId: 'settings-notification-settings',
  },
  {
    id: 'notification-rules',
    label: 'Notification rules',
    section: 'notifications',
    sectionLabel: 'Notifications',
    anchorId: 'settings-notification-rules',
  },
  {
    id: 'webhook-endpoints',
    label: 'Webhook endpoints',
    section: 'notifications',
    sectionLabel: 'Notifications',
    anchorId: 'settings-webhook-endpoints',
  },
  {
    id: 'notification-storage',
    label: 'Notification storage',
    section: 'notifications',
    sectionLabel: 'Notifications',
    anchorId: 'settings-notification-storage',
  },
  {
    id: 'ignored-repositories',
    label: 'Ignored repositories',
    section: 'notifications',
    sectionLabel: 'Notifications',
    anchorId: 'settings-ignored-repositories',
  },
  {
    id: 'keyboard-shortcuts',
    label: 'Keyboard shortcuts',
    section: 'shortcuts',
    sectionLabel: 'Shortcuts',
    anchorId: 'settings-keyboard-shortcuts',
  },
  {
    id: 'theme-editor',
    label: 'Theme editor',
    section: 'themes',
    sectionLabel: 'Themes',
    anchorId: 'settings-theme-editor',
  },
  {
    id: 'plugins',
    label: 'Plugins',
    section: 'plugins',
    sectionLabel: 'Plugins',
    anchorId: 'settings-plugins',
  },
  {
    id: 'configuration',
    label: 'Configuration',
    section: 'advanced',
    sectionLabel: 'Advanced',
    anchorId: 'settings-configuration',
  },
  {
    id: 'debug',
    label: 'Debug',
    section: 'advanced',
    sectionLabel: 'Advanced',
    anchorId: 'settings-debug',
  },
  {
    id: 'about',
    label: 'About',
    section: 'advanced',
    sectionLabel: 'Advanced',
    anchorId: 'settings-about',
  },
];

export function filterSettingsSearchItems(
  query: string,
  items: readonly SettingsSearchItem[] = SETTINGS_SEARCH_ITEMS
): SettingsSearchItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  return items.filter((item) =>
    `${item.label} ${item.sectionLabel}`.toLowerCase().includes(normalizedQuery)
  );
}

export function getSettingsSearchTarget(
  item: SettingsSearchItem
): Pick<SettingsSearchItem, 'section' | 'anchorId'> {
  return { section: item.section, anchorId: item.anchorId };
}
