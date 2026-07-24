export interface TranscriptRecord {
  kind: string;
  timestamp: string | null;
  content: string | null;
  toolName: string | null;
  toolInput: string | null;
  toolOutput: string | null;
  truncated: boolean;
}
