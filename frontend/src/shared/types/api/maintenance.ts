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

export interface MaintenanceAPI {
  scanClaudeDir: () => Promise<DirUsage[]>;
  cancelScan: () => Promise<void>;
  onScanProgress: (callback: (progress: MaintenanceScanProgress) => void) => () => void;
  scanCategory: (id: string) => Promise<Candidate[]>;
  getCutoff: (id: string) => Promise<number>;
  setCutoff: (id: string, days: number) => Promise<void>;
  trashItems: (paths: string[]) => Promise<TrashReceipt>;
  listTrash: () => Promise<TrashReceipt[]>;
  restoreTrash: (id: string) => Promise<void>;
  emptyTrash: (ids: string[]) => Promise<void>;
  onMuteWatcher: (callback: (muted: boolean) => void) => () => void;
}
