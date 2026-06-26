import type { NotificationTrigger } from './triggers';

/**
 * Application configuration settings.
 * Persisted to disk and loaded on app startup.
 */
export interface AppConfig {
  /** Notification-related settings */
  notifications: {
    /** Whether notifications are enabled globally */
    enabled: boolean;
    /** Whether to play sound with notifications */
    soundEnabled: boolean;
    /** Regex patterns for errors to ignore */
    ignoredRegex: string[];
    /** Repository group IDs to ignore for notifications */
    ignoredRepositories: string[];
    /** Unix timestamp until which notifications are snoozed (null if not snoozed) */
    snoozedUntil: number | null;
    /** Default snooze duration in minutes */
    snoozeMinutes: number;
    /** Whether to include errors from subagent sessions */
    includeSubagentErrors: boolean;
    /** Notification triggers - define when to generate notifications */
    triggers: NotificationTrigger[];
  };
  /** General application settings */
  general: {
    /** Whether to launch app at system login */
    launchAtLogin: boolean;
    /** Whether to show icon in dock (macOS) */
    showDockIcon: boolean;
    /** Application theme */
    theme: 'dark' | 'light' | 'system';
    /** Default tab to show on app launch */
    defaultTab: 'dashboard' | 'last-session';
    /** Optional custom Claude root folder (auto-detected when null) */
    claudeRootPath: string | null;
    /** Whether to auto-expand AI response groups when opening a transcript or receiving new messages */
    autoExpandAIGroups: boolean;
    /** Whether to use the native OS title bar instead of the custom one (Linux/Windows) */
    useNativeTitleBar: boolean;
  };
  /** Display and UI settings */
  display: {
    /** Whether to show timestamps in message views */
    showTimestamps: boolean;
    /** Whether to use compact display mode */
    compactMode: boolean;
    /** Whether to enable syntax highlighting in code blocks */
    syntaxHighlighting: boolean;
    /** Code block theme key */
    codeBlockTheme: string;
    /** Whether to show line numbers in code blocks */
    showLineNumbers: boolean;
    /** Whether to wrap long lines in code blocks */
    wordWrap: boolean;
  };
  /** Session-related settings */
  sessions: {
    /** Pinned sessions per project. Key is projectId, value is array of pinned sessions */
    pinnedSessions: Record<string, { sessionId: string; pinnedAt: number }[]>;
    /** Hidden sessions per project. Key is projectId, value is array of hidden sessions */
    hiddenSessions: Record<string, { sessionId: string; hiddenAt: number }[]>;
    /** Saved filter presets (sprint 35). */
    filterPresets?: FilterPresetEntry[];
    /** Default preset id auto-applied on first sidebar mount per launch (sprint 35). */
    defaultFilterPresetId?: string | null;
  };
  /** SSH connection settings */
  ssh?: {
    /** Last used connection details */
    lastConnection: {
      host: string;
      port: number;
      username: string;
      authMethod: 'password' | 'privateKey' | 'agent' | 'auto';
      privateKeyPath?: string;
    } | null;
    /** Whether to auto-reconnect on launch */
    autoReconnect: boolean;
    /** Saved SSH connection profiles */
    profiles: {
      id: string;
      name: string;
      host: string;
      port: number;
      username: string;
      authMethod: 'password' | 'privateKey' | 'agent' | 'auto';
      privateKeyPath?: string;
    }[];
    /** Last active context ID */
    lastActiveContextId: string;
  };
  /** HTTP sidecar server settings for iframe embedding */
  httpServer?: {
    /** Whether the HTTP server is enabled */
    enabled: boolean;
    /** Port for the HTTP server (default 3456) */
    port: number;
  };
  /** Dashboard widget ordering + hide list (sprint 32). */
  dashboard?: {
    widgetOrder?: string[];
    hiddenWidgets?: string[];
  };
  /** Keyboard shortcut overrides: action id → combo (sprint 33). */
  shortcuts?: {
    overrides?: Record<string, string>;
  };
  /** Custom CSS-variable themes (sprint 34). */
  themes?: {
    activeId?: string | null;
    custom?: CustomTheme[];
  };
  /** Plugin enable list (sprint 39). */
  plugins?: {
    enabled?: string[];
  };
  /** Notification rules engine (sprint 40). */
  notificationRules?: NotificationRule[];
  /** Webhook endpoints (sprint 41). */
  webhookEndpoints?: WebhookEndpoint[];
  /** Whether the first-run onboarding tour has been dismissed (sprint 49). */
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

/** Saved filter preset (sprint 35). The `filter` shape mirrors `SessionFilterState`
 * but is stored opaquely and validated in the frontend on read. */
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
