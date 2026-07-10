import { expect, test } from 'bun:test';

import { ENV_FLAG_CATALOG, lookupFlag } from './envFlagCatalog';

test('lookupFlag finds known flags by key with the right control kind', () => {
  expect(lookupFlag('DISABLE_TELEMETRY')?.kind).toBe('bool');
  expect(lookupFlag('CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY')?.kind).toBe('int');
});

test('lookupFlag returns undefined for unknown keys', () => {
  expect(lookupFlag('NOT_A_REAL_FLAG')).toBeUndefined();
});

test('catalog has exactly the five seeded flags', () => {
  expect(ENV_FLAG_CATALOG).toHaveLength(5);
});
