import { expect, test } from 'bun:test';

import { mergeEnv } from './envMerge';

test('bool flag ON writes "1", OFF removes the key', () => {
  const on = mergeEnv({ DISABLE_TELEMETRY: '1' }, []);
  expect(on.DISABLE_TELEMETRY).toBe('1');

  const off = mergeEnv({ DISABLE_TELEMETRY: undefined }, []);
  expect(off.DISABLE_TELEMETRY).toBeUndefined();
});

test('int flag value is set, empty removes the key', () => {
  const set = mergeEnv({ CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: '4' }, []);
  expect(set.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY).toBe('4');

  const cleared = mergeEnv({ CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: undefined }, []);
  expect(cleared.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY).toBeUndefined();
});

// Display-only masking test: the merge always receives the TRUE stored value
// for a secret row, never the "••••" placeholder — masking must never leak
// into what gets written.
test('an unrevealed secret survives merge with its true value, never the mask placeholder', () => {
  const result = mergeEnv({ DISABLE_TELEMETRY: '1' }, [
    { key: 'ANTHROPIC_API_KEY', value: 'sk-real' },
  ]);
  expect(result.ANTHROPIC_API_KEY).toBe('sk-real');
  expect(result.ANTHROPIC_API_KEY).not.toBe('••••');
});
