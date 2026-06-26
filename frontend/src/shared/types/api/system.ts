// Updater API

/**
 * Status payload sent from the main process updater to the renderer.
 */
export interface UpdaterStatus {
  type: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  releaseNotes?: string;
  progress?: { percent: number; transferred: number; total: number };
  error?: string;
}

/**
 * Updater API exposed via preload.
 */
export interface UpdaterAPI {
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  onStatus: (callback: (event: unknown, status: unknown) => void) => () => void;
}

// HTTP Server API

/**
 * HTTP server status returned from main process.
 */
export interface HttpServerStatus {
  running: boolean;
  port: number;
}

/**
 * HTTP Server API for controlling the sidecar server.
 */
export interface HttpServerAPI {
  start: () => Promise<HttpServerStatus>;
  stop: () => Promise<HttpServerStatus>;
  getStatus: () => Promise<HttpServerStatus>;
}
