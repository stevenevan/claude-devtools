import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

const capabilityPath = new URL('../../../../src-tauri/capabilities/default.json', import.meta.url);
const configPath = new URL('../../../../src-tauri/tauri.conf.json', import.meta.url);

test('Tauri capability stays least-privilege and CSP stays enabled', async () => {
  const capability = JSON.parse(await readFile(capabilityPath, 'utf8')) as {
    permissions: Array<string | { identifier: string }>;
  };
  const permissions = capability.permissions.map((permission) =>
    typeof permission === 'string' ? permission : permission.identifier
  );

  expect(permissions).toEqual(
    expect.arrayContaining([
      'core:event:allow-listen',
      'dialog:allow-open',
      'core:window:allow-close',
      'opener:allow-open-url',
    ])
  );
  expect(permissions).not.toEqual(
    expect.arrayContaining(['core:default', 'core:window:default', 'dialog:default', 'opener:default'])
  );

  const config = JSON.parse(await readFile(configPath, 'utf8')) as {
    app: { security: { csp: Record<string, string> | null } };
  };
  expect(config.app.security.csp).not.toBeNull();
  expect(config.app.security.csp?.['default-src']).toContain("'self'");
});
