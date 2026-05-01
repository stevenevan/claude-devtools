/**
 * Capability gate (sprint 38) — allowlist preamble executed inside the
 * sandbox Worker before any plugin code runs. Anything not on
 * `WORKER_GLOBAL_ALLOWLIST` is deleted from `self`. The unit test asserts
 * the allowlist directly so removing an entry from this file fails the
 * suite — no open-ended "this is undefined" checks.
 */

export const WORKER_GLOBAL_ALLOWLIST: readonly string[] = [
  'postMessage',
  'addEventListener',
  'removeEventListener',
  'console',
  'setTimeout',
  'clearTimeout',
  'self',
];

/**
 * Build the JavaScript preamble injected into the worker. Returns a
 * string (not a function reference) because the worker has no
 * cross-realm closure access to the host's lexical scope.
 */
export function buildCapabilityPreamble(): string {
  const allowlist = JSON.stringify(WORKER_GLOBAL_ALLOWLIST);
  return `(() => {
  const allow = new Set(${allowlist});
  const target = self;
  const props = Object.getOwnPropertyNames(target);
  for (const key of props) {
    if (!allow.has(key)) {
      try { delete target[key]; } catch (_e) { /* readonly globals are fine */ }
    }
  }
})();`;
}

export interface CapabilityProbeResult {
  fetch: 'undefined' | 'present';
  XMLHttpRequest: 'undefined' | 'present';
  importScripts: 'undefined' | 'present';
}

/**
 * Probe a worker scope's globals after the preamble has run. Used in
 * tests by passing a stand-in `self`-like object.
 */
export function probeWorkerScope(scope: Record<string, unknown>): CapabilityProbeResult {
  return {
    fetch: scope.fetch === undefined ? 'undefined' : 'present',
    XMLHttpRequest: scope.XMLHttpRequest === undefined ? 'undefined' : 'present',
    importScripts: scope.importScripts === undefined ? 'undefined' : 'present',
  };
}
