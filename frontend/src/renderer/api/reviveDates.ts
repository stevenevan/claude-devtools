// eslint-disable-next-line security/detect-unsafe-regex -- anchored pattern with bounded quantifier; no backtracking risk
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})?$/;

export function reviveDates<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string' && ISO_DATE_RE.test(obj)) {
    const d = new Date(obj);
    if (!isNaN(d.getTime())) return d as unknown as T;
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(reviveDates) as unknown as T;
  }
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = reviveDates(value);
    }
    return result as T;
  }
  return obj;
}
