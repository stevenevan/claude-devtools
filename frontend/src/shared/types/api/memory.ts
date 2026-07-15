// Memory manager DTOs (Week 28). Kind-prefixed dir IDs writes take instead of a
// path, per-dir integrity findings, and the byte-exact MEMORY.md index fixes
// the two auto-applicable finding kinds carry.

// MemoryDir is one addressable memory directory. id is a kind-prefixed,
// server-derived token ("project:<encoded>" / "agent:<name>"); label is the
// human-decoded name; path is absolute. kind ∈ "project" | "agent".
export interface MemoryDir {
  id: string;
  label: string;
  path: string;
  kind: string;
}

// MemoryFile is one fact file with its parsed frontmatter. fileName is the leaf
// on disk; name/description/type come from the frontmatter (type ∈
// user | feedback | project | reference).
export interface MemoryFile {
  fileName: string;
  name: string;
  description: string;
  type: string;
}

// MemoryIndexFix is a byte-exact MEMORY.md edit a finding proposes. op is "add"
// (append the line) or "remove" (drop the verbatim line). Passed back to
// applyMemoryIndexFix verbatim.
export interface MemoryIndexFix {
  op: string;
  line: string;
}

// MemoryFinding is one integrity issue. kind ∈ orphan-file | dangling-index |
// dangling-link | duplicate-slug. fix is non-null only for orphan-file (add)
// and dangling-index (remove); dangling-link and duplicate-slug are
// informational (fix null).
export interface MemoryFinding {
  kind: string;
  file: string;
  detail: string;
  fix: MemoryIndexFix | null;
}

export interface MemoryReport {
  dir: MemoryDir;
  files: MemoryFile[];
  findings: MemoryFinding[];
}
