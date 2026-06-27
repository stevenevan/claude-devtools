import type { NotificationTrigger } from './triggers';

export interface AppConfig {

  notifications: {

    enabled: boolean;

    soundEnabled: boolean;

    ignoredRegex: string[];

    ignoredRepositories: string[];

    snoozedUntil: number | null;

    snoozeMinutes: number;

    includeSubagentErrors: boolean;

    triggers: NotificationTrigger[];
  };

  general: {

    launchAtLogin: boolean;

    theme: 'dark' | 'light' | 'system';

    defaultTab: 'dashboard' | 'last-session';

    claudeRootPath: string | null;

    autoExpandAIGroups: boolean;

    useNativeTitleBar: boolean;
  };

  display: {

    codeBlockTheme: string;

    showLineNumbers: boolean;

    wordWrap: boolean;
  };

  sessions: {

    pinnedSessions: Record<string, { sessionId: string; pinnedAt: number }[]>;

    hiddenSessions: Record<string, { sessionId: string; hiddenAt: number }[]>;

    filterPresets?: FilterPresetEntry[];

    defaultFilterPresetId?: string | null;
  };

  ssh?: {

    lastConnection: {
      host: string;
      port: number;
      username: string;
      authMethod: 'password' | 'privateKey' | 'agent' | 'auto';
      privateKeyPath?: string;
    } | null;

    autoReconnect: boolean;

    profiles: {
      id: string;
      name: string;
      host: string;
      port: number;
      username: string;
      authMethod: 'password' | 'privateKey' | 'agent' | 'auto';
      privateKeyPath?: string;
    }[];

    lastActiveContextId: string;
  };

  httpServer?: {

    enabled: boolean;

    port: number;
  };

  dashboard?: {
    widgetOrder?: string[];
    hiddenWidgets?: string[];
  };

  shortcuts?: {
    overrides?: Record<string, string>;
  };

  themes?: {
    activeId?: string | null;
    custom?: CustomTheme[];
  };

  plugins?: {
    enabled?: string[];
  };

  notificationRules?: NotificationRule[];

  webhookEndpoints?: WebhookEndpoint[];

  onboardingCompleted?: boolean;
}

export interface WebhookEndpoint {
  id: string;
  label: string;
  url: string;
  template: string;
}

// Notification rules DSL (sprint 40)

export type NotificationRulePredicate =
  | { kind: 'toolName'; equals: string }
  | { kind: 'durationGt'; ms: number }
  | { kind: 'error'; isError: boolean }
  | { kind: 'costGt'; usd: number }
  | { kind: 'regexMatch'; pattern: string };

export type NotificationRuleNode =
  | { kind: 'all'; children: NotificationRuleNode[] }
  | { kind: 'any'; children: NotificationRuleNode[] }
  | { kind: 'predicate'; predicate: NotificationRulePredicate };

export type NotificationRuleAction =
  | { kind: 'notify' }
  | { kind: 'badge' }
  | { kind: 'webhook'; url: string; template: string };

export interface NotificationRule {
  id: string;
  name: string;
  enabled: boolean;
  condition: NotificationRuleNode;
  action: NotificationRuleAction;
}

export interface CustomTheme {
  id: string;
  name: string;
  basedOn: 'dark' | 'light';
  overrides: Record<string, string>;
}

export interface FilterPresetEntry {
  id: string;
  name: string;
  filter: FilterPresetPayload;
  createdAt: number;
}

export interface FilterPresetPayload {
  dateMin?: number;
  dateMax?: number;
  minContext?: number;
  maxContext?: number;
  minCompactions?: number;
  agentName?: string;
  tags?: string[];
}
