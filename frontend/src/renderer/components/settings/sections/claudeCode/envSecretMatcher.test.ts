import { expect, test } from 'bun:test';

import { isSecretKey } from './envSecretMatcher';

test('isSecretKey matches secret-shaped keys (fail-open fixtures)', () => {
  expect(isSecretKey('AWS_SECRET_ACCESS_KEY')).toBe(true);
  expect(isSecretKey('DB_PASSWORD')).toBe(true);
  expect(isSecretKey('SECRET_KEY')).toBe(true);
  expect(isSecretKey('ANTHROPIC_API_KEY')).toBe(true);
  expect(isSecretKey('GITHUB_TOKEN')).toBe(true);
  expect(isSecretKey('MY_PAT')).toBe(true);
});

test('isSecretKey does not match benign keys', () => {
  expect(isSecretKey('DISABLE_TELEMETRY')).toBe(false);
  expect(isSecretKey('EDITOR')).toBe(false);
});
