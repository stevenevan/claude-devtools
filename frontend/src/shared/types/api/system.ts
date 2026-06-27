// Updater API

export interface UpdaterStatus {
  type: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  releaseNotes?: string;
  progress?: { percent: number; transferred: number; total: number };
  error?: string;
}

export interface UpdaterAPI {
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  onStatus: (callback: (event: unknown, status: unknown) => void) => () => void;
}

// HTTP Server API

export interface HttpServerStatus {
  running: boolean;
  port: number;
}

export interface HttpServerAPI {
  start: () => Promise<HttpServerStatus>;
  stop: () => Promise<HttpServerStatus>;
  getStatus: () => Promise<HttpServerStatus>;
}
