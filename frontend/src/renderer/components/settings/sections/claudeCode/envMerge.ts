export interface RawEnvRow {
  key: string;
  value: string;
}

// Single safe write rule, no presence-vs-value foot-gun: a known flag's value
// of `undefined` means "unset" (removed from the map), any string means "set
// to exactly this string". Bool ON/OFF and int set/clear both resolve to this
// before calling mergeEnv. Raw unknown rows pass through as-is.
export function mergeEnv(
  known: Record<string, string | undefined>,
  rawRows: RawEnvRow[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rawRows) {
    const key = row.key.trim();
    if (key) out[key] = row.value;
  }
  for (const [key, value] of Object.entries(known)) {
    if (value === undefined) {
      delete out[key];
    } else {
      out[key] = value;
    }
  }
  return out;
}
