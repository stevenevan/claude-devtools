// Maintenance API (storage scan Week 1, safe-delete trash engine Week 2)

import type { AgentPatch, GlobalAgent, SkillInventoryEntry } from './agents';
import type { ImportPreview, Manifest } from './configBackup';
import type { MemoryDir, MemoryIndexFix, MemoryReport } from './memory';
import type { CombinedReport } from './retention';

export interface DirUsage {
  path: string;
  bytes: number;
  files: number;
  modTime: Date;
  isSymlink: boolean;
  err?: string;
}

export interface MaintenanceScanProgress {
  dirsVisited: number;
  bytes: number;
}

// Candidate is one cleanup candidate surfaced by scanCategory (Week 3+). It
// only describes what could be removed — the delete itself always routes back
// through trashItems. meta/reason/group are filesystem-derived: render as plain
// text, never HTML.
export interface Candidate {
  path: string;
  bytes: number;
  files: number;
  modTime: Date;
  reason: string;
  group?: string;
  meta?: Record<string, string>;
}

export interface TrashedItem {
  origPath: string;
  relStore: string;
  bytes: number;
}

export interface TrashReceipt {
  id: string;
  trashedAt: Date;
  items: TrashedItem[];
}

// HistoryMonth is one bucket of the history.jsonl histogram (Week 10).
export interface HistoryMonth {
  month: string;
  lines: number;
  bytes: number;
}

// HistoryStats summarizes history.jsonl for the Week 10 retention panel.
export interface HistoryStats {
  totalLines: number;
  bytes: number;
  malformed: number;
  oldestMs: number;
  newestMs: number;
  months: HistoryMonth[];
  prunableLines: number;
  prunableBytes: number;
}

// HealthFlag is one known mode-flag dotfile (e.g. .caveman-active) for the
// Week 14 read-only health panel.
export interface HealthFlag {
  name: string;
  present: boolean;
  content: string;
}

// HealthStatus is the read-only health snapshot for the Week 14 panel. Times
// are file mtimes in ms — a reliable signal regardless of file content format.
export interface HealthStatus {
  lastCleanupMs: number;
  lastCleanupRaw: string;
  lastUpdateRaw: string;
  lastUpdateStatus: string;
  lastUpdateVersion: string;
  lastUpdateParseErr: boolean;
  daemonPresent: boolean;
  daemonLastWriteMs: number;
  daemonTail: string[];
  flags: HealthFlag[];
}

// InstructionFile is one entry in listInstructionFiles' result: an
// allowlisted global instruction file's size and approximate context-window
// cost (Week 25 context-cost meter).
export interface InstructionFile {
  relPath: string;
  bytes: number;
  approxTokens: number;
}

export interface MaintenanceAPI {
  scanClaudeDir: () => Promise<DirUsage[]>;
  cancelScan: () => Promise<void>;
  onScanProgress: (callback: (progress: MaintenanceScanProgress) => void) => () => void;
  scanCategory: (id: string) => Promise<Candidate[]>;
  getCutoff: (id: string) => Promise<number>;
  setCutoff: (id: string, days: number) => Promise<void>;
  readPlanFile: (name: string) => Promise<string>;
  trashItems: (paths: string[]) => Promise<TrashReceipt>;
  listTrash: () => Promise<TrashReceipt[]>;
  restoreTrash: (id: string) => Promise<void>;
  emptyTrash: (ids: string[]) => Promise<void>;
  onMuteWatcher: (callback: (muted: boolean) => void) => () => void;
  rollbackBinary: (activePath: string, backupPath: string) => Promise<TrashReceipt>;
  analyzeHistory: () => Promise<HistoryStats>;
  pruneHistory: (cutoffDays: number) => Promise<TrashReceipt>;
  onTrashed: (callback: (projects: string[]) => void) => () => void;
  clearFiles: (paths: string[], truncate: boolean) => Promise<void>;
  getMaintenanceHealth: () => Promise<HealthStatus>;

  // Settings generations diff/restore (Week 15). List/read are read-only (no
  // gate); restore is the destructive, SSH-gated write.
  listSettingsGenerations: () => Promise<string[]>;
  readSettingsGeneration: (name: string) => Promise<string>;
  restoreSettingsGeneration: (name: string) => Promise<void>;
  // callback receives the changed file's path when available, so consumers can
  // filter (e.g. the ~/.claude.json inspector only cares about that file).
  onConfigFileChange: (callback: (path?: string) => void) => () => void;

  // Instruction-file editors (Week 25): global CLAUDE.md/RTK.md/rules/
  // commands/tools allowlist. List/read are read-only; write/delete are
  // SSH-gated + serialized on the backend.
  listInstructionFiles: () => Promise<InstructionFile[]>;
  readInstructionFile: (relPath: string) => Promise<string>;
  writeInstructionFile: (relPath: string, content: string) => Promise<void>;
  deleteInstructionFile: (relPath: string) => Promise<TrashReceipt>;

  // Agents manager (Week 26): root-threaded list + typed frontmatter/body
  // patch + create/delete of ~/.claude/agents/*.md. List is read-only;
  // patch/create/delete are SSH-gated + serialized on the backend. deleteAgent
  // trashes the file (restorable), returning a TrashReceipt.
  listManagedAgents: () => Promise<GlobalAgent[]>;
  patchAgentFrontmatter: (fileBase: string, patch: AgentPatch) => Promise<void>;
  createAgent: (name: string, description: string) => Promise<void>;
  deleteAgent: (fileBase: string) => Promise<TrashReceipt>;

  // Skills manager (Week 27): root-threaded inventory + SKILL.md read/write +
  // remove-symlink vs delete-skill. Inventory/read are read-only; write/remove/
  // delete are SSH-gated + serialized on the backend. removeSkillLink trashes
  // the link only (never its target); deleteSkill trashes a real dir — both
  // return a TrashReceipt. Skills have no enable/disable — presence == enabled.
  skillsInventory: () => Promise<SkillInventoryEntry[]>;
  readSkillDoc: (skillName: string) => Promise<string>;
  writeSkillDoc: (skillName: string, content: string) => Promise<void>;
  removeSkillLink: (skillName: string) => Promise<TrashReceipt>;
  deleteSkill: (skillName: string) => Promise<TrashReceipt>;

  // Memory manager (Week 28): kind-prefixed dir enumeration + per-dir integrity
  // scan + fact-file read/write + index-fix apply + delete. listMemoryDirs and
  // memoryIntegrity are read-only; write/applyFix/delete are SSH-gated +
  // serialized on the backend, which refuses writes under the consolidation
  // lock and re-derives an index fix before applying it. deleteMemoryFile
  // trashes a fact file (restorable), returning a TrashReceipt.
  listMemoryDirs: () => Promise<MemoryDir[]>;
  memoryIntegrity: (dirID: string) => Promise<MemoryReport>;
  readMemoryFile: (dirID: string, fileName: string) => Promise<string>;
  writeMemoryFile: (dirID: string, fileName: string, content: string) => Promise<void>;
  applyMemoryIndexFix: (dirID: string, fix: MemoryIndexFix) => Promise<void>;
  deleteMemoryFile: (dirID: string, fileName: string) => Promise<TrashReceipt>;

  // Config backup / export-import (Week 24). Capture/list/restore/delete a
  // whole-profile config backup; export packs an archive behind a native
  // SaveFile dialog (secrets stripped unless includeSecrets); import validates a
  // user-picked archive behind a native OpenFile dialog and applies ONLY the
  // explicitly confirmed categories (imported hooks always land disabled).
  // Mutations are SSH-gated + serialized on the backend; the frontend
  // dual-gates. captureConfig/listConfigBackups return Manifests whose createdMs
  // is epoch-ms (never a Date); validateImportDialog returns archivePath === ""
  // when the user cancels the native dialog.
  captureConfig: (label: string) => Promise<Manifest>;
  listConfigBackups: () => Promise<Manifest[]>;
  restoreConfig: (id: string, relPaths: string[]) => Promise<void>;
  deleteConfigBackup: (id: string) => Promise<void>;
  exportBackup: (id: string, includeSecrets: boolean) => Promise<void>;
  validateImportDialog: () => Promise<ImportPreview>;
  applyImport: (archivePath: string, confirmedCategories: string[]) => Promise<void>;

  // Retention policy Clean-now (Week 31). previewPolicyClean is the read-only
  // combined dry-run (no gate); runPolicyClean is SSH-gated and throws if a run
  // is already in progress; cancelPolicyClean interrupts a run between
  // categories. Cutoffs read through the single getCutoff/setCutoff store.
  previewPolicyClean: () => Promise<CombinedReport>;
  runPolicyClean: () => Promise<CombinedReport>;
  cancelPolicyClean: () => Promise<void>;
}
