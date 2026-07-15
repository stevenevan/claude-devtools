import { expect, test } from 'bun:test';

import { redactSecretValues } from './redactSecrets';

test('redactSecretValues masks secret-keyed and secret-shaped values, leaves the rest', () => {
  const input = {
    env: {
      ANTHROPIC_API_KEY: 'sk-ant-x',
    },
    randomField: 'sk-ant-y',
    args: ['--token', 'ghp_abc'],
    greeting: 'hello',
    foo: 'bar',
  };

  const result = redactSecretValues(input) as typeof input;

  expect(result.env.ANTHROPIC_API_KEY).toBe('••••');
  expect(result.randomField).toBe('••••');
  expect(result.args[0]).toBe('--token');
  expect(result.args[1]).toBe('••••');
  expect(result.greeting).toBe('hello');
  expect(result.foo).toBe('bar');
});
