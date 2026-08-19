import type {
  CodexInventoryDiagnostic,
  CodexInventorySummary,
} from './codexInventory';

export type CodexPluginState = 'installed' | 'available' | 'invalid' | 'unknown';
export type CodexPluginCapabilityKind = 'skill' | 'mcpServer' | 'app' | 'hook';

export interface CodexPluginSource {
  kind: string;
  label: string;
}

export interface CodexPluginCapability {
  kind: CodexPluginCapabilityKind;
  name: string;
  ownerPluginId: string;
  linkedRecordId: string | null;
}

export interface CodexPluginSummary {
  id: string;
  name: string;
  displayName: string | null;
  description: string;
  version: string | null;
  state: CodexPluginState;
  source: CodexPluginSource;
  capabilities: CodexPluginCapability[];
  diagnostics: CodexInventoryDiagnostic[];
}

export interface CodexPluginList {
  items: CodexPluginSummary[];
  summary: CodexInventorySummary;
}
