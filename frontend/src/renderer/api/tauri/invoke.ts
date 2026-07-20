import { invoke } from '@tauri-apps/api/core';

import { reviveDates } from '../reviveDates';

// Thin wrapper over Tauri `invoke` for the ported command methods (W3+).
// `reviveDates` is OPT-IN per call, default off: the legacy adapters revive only a
// hand-picked subset of results and deliberately skip the rest, so a blanket
// revive would break parity (a raw ISO string on the legacy path would become a
// Date on the Tauri path) and needlessly deep-clone every large payload. Each
// ported method opts in iff its legacy twin does.
export async function call<T>(
  command: string,
  args?: Record<string, unknown>,
  opts?: { reviveDates?: boolean }
): Promise<T> {
  const result = await invoke<T>(command, args);
  return opts?.reviveDates ? reviveDates(result) : result;
}
