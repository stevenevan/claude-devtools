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
  trashItems: (paths: string[]) => Promise<TrashReceipt>;
  listTrash: () => Promise<TrashReceipt[]>;
  restoreTrash: (id: string) => Promise<void>;
  emptyTrash: (ids: string[]) => Promise<void>;
  onMuteWatcher: (callback: (muted: boolean) => void) => () => void;
}
