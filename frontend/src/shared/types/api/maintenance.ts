// Maintenance API (storage scan Week 1, safe-delete trash engine Week 2)

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
}
