// Backend observability (sprint 46)

export interface BackendTimingSummary {
  command: string;
  count: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

export interface BackendCacheStats {
  capacity: number;
  size: number;
  hits: number;
  misses: number;
  evicts: number;
  hitRate: number;
}
