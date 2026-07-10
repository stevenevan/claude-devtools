import { isSecretKey } from '../settings/sections/claudeCode/envSecretMatcher';

// Value shapes that look like secrets regardless of key name: common API key
// prefixes (sk-, gh*, AKIA, xox*), OAuth bearer tokens, and JWTs — catches
// array-embedded and benign-key secrets that key-based masking alone misses.
const SECRET_VALUE_PATTERN =
  /^(sk-|ghp_|gho_|github_pat_|AKIA|xox[baprs]-|eyJ[A-Za-z0-9_-]+\.|Bearer )/;

function isSecretValue(value: unknown): boolean {
  return typeof value === 'string' && SECRET_VALUE_PATTERN.test(value);
}

// Replaces any value whose key looks like a secret, or whose value matches a
// known token shape, with a mask placeholder — so settings.json views never
// render secrets in cleartext by default.
export function redactSecretValues(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => (isSecretValue(item) ? '••••' : redactSecretValues(item)));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSecretKey(key) || isSecretValue(v) ? '••••' : redactSecretValues(v);
    }
    return out;
  }
  return value;
}
