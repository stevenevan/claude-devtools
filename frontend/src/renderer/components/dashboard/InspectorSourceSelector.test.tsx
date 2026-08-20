import { expect, test } from 'bun:test';

import { readFileSync } from 'node:fs';

const selectorSource = readFileSync(new URL('./InspectorSourceSelector.tsx', import.meta.url), 'utf8');

test('source selector exposes source capability and unavailable-state summaries', () => {
  expect(selectorSource).toContain('maintenanceCapabilitySummary');
  expect(selectorSource).toContain('selectedStatus?.state !== \'available\'');
  expect(selectorSource).toContain('taskGraphStateLabel');
  expect(selectorSource).toContain('selectedStatus.capabilities.maintenance');
});
