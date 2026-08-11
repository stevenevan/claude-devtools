import { expect, test } from 'bun:test';

import { readFileSync } from 'node:fs';

import type { DryRunSummary } from './DryRunConfirmDialog';

const source = readFileSync(new URL('./DryRunConfirmDialog.tsx', import.meta.url), 'utf8');
const simpleSource = readFileSync(new URL('./SpaceSummary.tsx', import.meta.url), 'utf8');

test('summary mode renders category aggregates without path fields', () => {
  const summary: DryRunSummary = {
    totalCandidates: 3,
    totalBytes: 120,
    categories: [{ id: 'everything-else', label: 'Everything else', candidates: 3, bytes: 120 }],
  };

  expect(summary.categories.map((category) => category.label)).toEqual(['Everything else']);
  expect(source).toContain('summary.categories.map');
  expect(source).toContain('(paths ?? []).map');
  expect(source).not.toContain('summary.categories.map((category) => category.path');
});

test('Simple summary has no permanent-delete action in its call site', () => {
  expect(source).toContain('onDeletePermanently?:');
  expect(source).toContain('{onDeletePermanently &&');
  expect(simpleSource).toContain('onMoveToTrash={() => void handleMoveToTrash()}');
  expect(simpleSource).not.toContain('onDeletePermanently=');
});
