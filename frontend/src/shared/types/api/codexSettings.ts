export interface CodexSettingsContext {
  projectRoot: string;
  workingDirectory?: string | null;
  profile?: string | null;
}

export interface CodexSettingsContextView {
  projectRoot: string;
  workingDirectory: string;
  profile: string | null;
  profileIsProjection: boolean;
  cliOverridesAvailable: boolean;
}

export interface CodexTrustStatus {
  state: 'trusted' | 'untrusted' | 'unknown';
  sourceLabel: string;
  reason: string | null;
}

export interface CodexSettingValue {
  kind: string;
  scalar: string | null;
  display: string;
  structured: unknown | null;
  redacted: boolean;
}

export interface CodexSourceValue {
  key: string;
  value: CodexSettingValue;
  editable: boolean;
  readOnlyReason: string | null;
}

export interface CodexShadowedValue {
  sourceId: string;
  sourceLabel: string;
  value: CodexSettingValue;
}

export interface CodexResolvedSetting {
  key: string;
  value: CodexSettingValue;
  sourceId: string;
  sourceLabel: string;
  editable: boolean;
  readOnlyReason: string | null;
  userValue: CodexSettingValue | null;
  shadowed: CodexShadowedValue[];
}

export interface CodexDiagnostic {
  sourceId: string;
  severity: string;
  code: string;
  message: string;
  line: number | null;
  column: number | null;
}

export interface CodexSettingsSource {
  id: string;
  label: string;
  kind: string;
  status: string;
  active: boolean;
  precedence: number;
  revision: string | null;
  supportedKeys: string[];
  values: CodexSourceValue[];
  diagnostics: CodexDiagnostic[];
}

export interface CodexProvenanceRow {
  key: string;
  sourceId: string;
  sourceLabel: string;
  note: string;
}

export interface CodexPolicyConstraint {
  key: string;
  value: CodexSettingValue;
  sourceLabel: string;
}

export interface CodexPolicyStatus {
  localRequirementsAvailable: boolean;
  cloudRequirementsAvailable: boolean;
  resolution: 'complete' | 'incomplete';
  constraints: CodexPolicyConstraint[];
  diagnostics: CodexDiagnostic[];
}

export interface CodexSettingsView {
  context: CodexSettingsContextView;
  trust: CodexTrustStatus;
  settings: CodexResolvedSetting[];
  sources: CodexSettingsSource[];
  provenance: CodexProvenanceRow[];
  diagnostics: CodexDiagnostic[];
  policy: CodexPolicyStatus;
  userRevision: string;
  target: string;
  canEdit: boolean;
}

export interface CodexSettingsPatch {
  model?: string | null;
  approvalPolicy?: string | null;
  sandboxMode?: string | null;
}

export interface CodexFieldDiff {
  key: string;
  oldValue: string;
  newValue: string;
}

export interface CodexSettingsPreview {
  target: string;
  expectedRevision: string;
  currentRevision: string;
  proposedRevision: string;
  diff: CodexFieldDiff[];
  warnings: string[];
  canApply: boolean;
}

export interface CodexSettingsConflict {
  target: string;
  expectedRevision: string;
  actualRevision: string;
  message: string;
}

export type CodexSettingsPreviewResult =
  | { status: 'ready'; data: CodexSettingsPreview }
  | { status: 'conflict'; data: CodexSettingsConflict };

export interface CodexSnapshotStatus {
  created: boolean;
  identity: string;
  note: string;
}

export interface CodexVerifiedField {
  key: string;
  value: string;
}

export interface CodexWriteVerification {
  verified: boolean;
  fields: CodexVerifiedField[];
}

export interface CodexSettingsWriteResult {
  target: string;
  revision: string;
  diff: CodexFieldDiff[];
  snapshot: CodexSnapshotStatus;
  verification: CodexWriteVerification;
}

export type CodexSettingsApplyResult =
  | { status: 'applied'; data: CodexSettingsWriteResult }
  | { status: 'conflict'; data: CodexSettingsConflict };
