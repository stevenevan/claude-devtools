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
