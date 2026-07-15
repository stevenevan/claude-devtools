// Retention policy Clean-now DTOs (Week 31). CombinedReport is returned by both
// previewPolicyClean (dry-run) and runPolicyClean (executed). No Date fields —
// plain casts, never reviveDates.

// CategoryReport is one policy category's contribution to a Clean-now pass: how
// many candidates, their total bytes, and the paths (expandable in the UI).
export interface CategoryReport {
  id: string;
  count: number;
  bytes: number;
  paths: string[];
}

// CombinedReport aggregates every enabled category plus the count of trash
// receipts the expiry sweep removed (or would remove, in a dry run).
export interface CombinedReport {
  categories: CategoryReport[];
  trashExpiryCount: number;
}
