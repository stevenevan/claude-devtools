// Read-only ~/.claude.json inspector types (Week 20). The census carries key
// name + value kind + size only — never a raw value; per-value display goes
// through revealClaudeJSONValue, and backups are server-side masked.

export type ClaudeJSONTriage = 'live' | 'stale' | 'unverifiable';

export interface ClaudeJSONKey {
  name: string;
  kind: string;
  bytes: number;
  secret: boolean;
}

export interface ClaudeJSONProject {
  path: string;
  bytes: number;
  keyCount: number;
  triage: ClaudeJSONTriage;
}

export interface ClaudeJSONCensus {
  path: string;
  bytes: number;
  topLevel: ClaudeJSONKey[];
  flags: ClaudeJSONKey[];
  projects: ClaudeJSONProject[];
}

export interface ClaudeJSONBackup {
  name: string;
  bytes: number;
  modTime: Date;
}
