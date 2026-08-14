export type CodexInventoryScope =
  | { kind: 'global' }
  | { kind: 'project'; projectId: string };

export type CodexValidationState = 'valid' | 'missing' | 'malformed' | 'invalid';
export type CodexEnabledState = 'enabled' | 'disabled' | 'inherited' | 'unknown';

export interface CodexSourceIdentity {
  id: string;
  scope: CodexInventoryScope;
  relativePath: string;
  label: string;
}

export interface CodexInventoryDiagnostic {
  severity: string;
  code: string;
  message: string;
  sourceId: string | null;
  relativePath: string | null;
}

export interface CodexInventorySummary {
  scope: CodexInventoryScope;
  scanLimited: boolean;
  omittedCount: number;
  diagnostics: CodexInventoryDiagnostic[];
}

export interface CodexInstructionSource {
  identity: CodexSourceIdentity;
  active: boolean;
  priority: number;
  state: CodexValidationState;
  bytes: number;
  truncated: boolean;
  revision: string | null;
  diagnostics: CodexInventoryDiagnostic[];
}

export interface CodexInstructionList {
  items: CodexInstructionSource[];
  summary: CodexInventorySummary;
}

export interface CodexInstructionDetail {
  source: CodexInstructionSource;
  content: string;
  truncated: boolean;
  exactRevision: string;
  untrusted: boolean;
}

export interface CodexUnresolvedCapability {
  name: string;
  kind: string;
  resolved: boolean;
}

export interface CodexAgentSummary {
  identity: CodexSourceIdentity;
  name: string;
  description: string;
  state: CodexValidationState;
  revision: string | null;
  developerInstructionsAvailable: boolean;
  model: string | null;
  effort: string | null;
  sandboxMode: string | null;
  declaredCapabilities: CodexUnresolvedCapability[];
  diagnostics: CodexInventoryDiagnostic[];
}

export interface CodexAgentList {
  items: CodexAgentSummary[];
  summary: CodexInventorySummary;
}

export interface CodexAgentDetail {
  agent: CodexAgentSummary;
  developerInstructions: string | null;
  truncated: boolean;
  exactRevision: string;
  untrusted: boolean;
}

export interface CodexSkillResource {
  kind: string;
  relativePath: string;
}

export interface CodexSkillSummary {
  identity: CodexSourceIdentity;
  name: string;
  description: string;
  state: CodexValidationState;
  enabledState: CodexEnabledState;
  enabledSource: string | null;
  symlink: boolean;
  externalTarget: boolean;
  entryPoint: string;
  resources: CodexSkillResource[];
  metadataTruncated: boolean;
  revision: string | null;
  diagnostics: CodexInventoryDiagnostic[];
}

export interface CodexSkillList {
  items: CodexSkillSummary[];
  summary: CodexInventorySummary;
}

export interface CodexSkillDetail {
  skill: CodexSkillSummary;
  content: string;
  truncated: boolean;
  exactRevision: string | null;
  untrusted: boolean;
}

export interface CodexDiffLine {
  kind: 'add' | 'remove';
  text: string;
}

export interface CodexTextPreview {
  recordId: string;
  currentRevision: string;
  proposedRevision: string;
  diff: CodexDiffLine[];
  warnings: string[];
  canApply: boolean;
}

export interface CodexTextConflict {
  recordId: string;
  expectedRevision: string;
  actualRevision: string;
  message: string;
}

export type CodexTextPreviewResult =
  | { status: 'ready'; data: CodexTextPreview }
  | { status: 'conflict'; data: CodexTextConflict };

export interface CodexTextWriteResult {
  recordId: string;
  revision: string;
  backupCreated: boolean;
}

export type CodexTextApplyResult =
  | { status: 'applied'; data: CodexTextWriteResult }
  | { status: 'conflict'; data: CodexTextConflict };

