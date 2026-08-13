export type SourceKind = 'claude' | 'codex';

export type SourceState = 'available' | 'notFound' | 'invalid' | 'unreadable' | 'unsupported';

export type TaskGraphCapabilityState = 'available' | 'missing' | 'unsupportedCapability';

export interface InspectorDiagnostic {
  code: string;
  message: string;
  line?: number;
  field?: string;
}

export interface TaskGraphCapability {
  state: TaskGraphCapabilityState;
  reason: string;
  diagnostics: InspectorDiagnostic[];
}

export interface SourceCapabilities {
  sessions: boolean;
  transcripts: boolean;
  taskGraph: TaskGraphCapability;
}

export interface InspectorSourceStatus {
  sourceKind: SourceKind;
  state: SourceState;
  label: string;
  revision?: string;
  reason?: string;
  capabilities: SourceCapabilities;
}

export interface InspectorProvenance {
  sourceFile: string;
  line?: number;
  archived: boolean;
}

export interface InspectorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  totalMatched: number | null;
  scanLimited: boolean;
  diagnostics: InspectorDiagnostic[];
}

export interface InspectorHistoryEntry {
  sessionId: string | null;
  display: string;
  project: string;
  timestamp: number | null;
  pastedCount: number;
  source: SourceKind;
  provenance: InspectorProvenance;
}

export interface InspectorTranscriptMeta {
  id: string;
  label: string;
  sizeBytes: number;
  mtime: number | null;
  source: SourceKind;
  archived: boolean;
  provenance: InspectorProvenance;
}

export interface InspectorEvent {
  kind: string;
  timestamp: string | null;
  role: string | null;
  content: string | null;
  toolName: string | null;
  toolId: string | null;
  toolInputShape: string | null;
  toolOutputSize: number | null;
  toolStatus: string | null;
  truncated: boolean;
  provenance: InspectorProvenance;
}

export interface InspectorTaskGraphMeta {
  id: string;
  label: string | null;
  taskCount: number;
  latestMtime: number;
  source: SourceKind;
}

export interface InspectorTaskGraphList {
  capability: TaskGraphCapability;
  items: InspectorTaskGraphMeta[];
}

export interface InspectorTaskGraphResult {
  id: string;
  nodes: TaskNodeData[];
  capability: TaskGraphCapability;
}

export interface TaskNodeData {
  id: string;
  subject: string;
  description: string;
  activeForm: string;
  status: string;
  blocks: string[];
  blockedBy: string[];
}
