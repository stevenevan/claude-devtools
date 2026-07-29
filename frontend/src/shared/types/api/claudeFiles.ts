export interface FileMeta {
  name: string;
  sizeBytes: number;
  mtime: number;
}

export interface CheckpointGroup {
  sessionUuid: string;
  fileHash: string;
  versions: number[];
  latestMtime: number;
  latestSize: number;
}

export interface CheckpointOrigin {
  realPath: string;
  backupTime: string | null;
}
