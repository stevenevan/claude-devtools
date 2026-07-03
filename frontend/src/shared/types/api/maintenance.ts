// Maintenance API (storage scan, Week 1)

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

export interface MaintenanceAPI {
  scanClaudeDir: () => Promise<DirUsage[]>;
  cancelScan: () => Promise<void>;
  onScanProgress: (callback: (progress: MaintenanceScanProgress) => void) => () => void;
}
