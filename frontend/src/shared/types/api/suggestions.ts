// Permission-rule suggestions (Week 30). A Suggestion is a proposed
// permission-allow rule mined from the user's own structured tool_use records.
// `list` is always 'allow'. Read-only; derived from usage, not vetted.

export interface Suggestion {
  rule: string;
  list: string;
  evidenceCount: number;
  sessionCount: number;
  samples: string[];
}
