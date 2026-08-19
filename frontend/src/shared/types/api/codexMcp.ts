import type {
  CodexInventoryDiagnostic,
  CodexInventorySummary,
} from './codexInventory';

export type CodexMcpTransport = 'stdio' | 'http' | 'unknown';
export type CodexMcpEnabledState = 'enabled' | 'disabled' | 'unknown';
export type CodexMcpCheckState = 'notChecked' | 'yes' | 'no';

export interface CodexMcpServerSummary {
  id: string;
  name: string;
  sourceLabel: string;
  sourceKind: string;
  pluginOwnerId: string | null;
  transport: CodexMcpTransport;
  configured: boolean;
  enabled: CodexMcpEnabledState;
  reachable: CodexMcpCheckState;
  approvalMode: string | null;
  approvalObserved: CodexMcpCheckState;
  observed: CodexMcpCheckState;
  commandConfigured: boolean;
  endpointConfigured: boolean;
  credentialsConfigured: boolean;
  advertisedToolCount: number;
  enabledTools: string[];
  disabledTools: string[];
  diagnostics: CodexInventoryDiagnostic[];
}

export interface CodexMcpPolicySummary {
  approvalMode: string | null;
  sandboxMode: string | null;
  hooksConfigured: boolean;
  sourceLabels: string[];
  diagnostics: CodexInventoryDiagnostic[];
}

export interface CodexMcpStatusView {
  servers: CodexMcpServerSummary[];
  policy: CodexMcpPolicySummary;
  summary: CodexInventorySummary;
}
