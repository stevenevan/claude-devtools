import { expect, test } from 'bun:test';

import { readFileSync } from 'node:fs';

import { createSourceRequestGate } from './sourceRequestGate';

const panelSource = readFileSync(new URL('./FileHistoryBrowserPanel.tsx', import.meta.url), 'utf8');

test('a late list response cannot replace a newer source request', () => {
  const gate = createSourceRequestGate();
  gate.switchSource();
  const requestA = gate.begin('list');
  const requestB = gate.begin('list');

  let authoritative = 'none';
  if (gate.isCurrent('list', requestB)) authoritative = 'B';
  if (gate.isCurrent('list', requestA)) authoritative = 'A';

  expect(authoritative).toBe('B');
  expect(gate.isCurrent('list', requestA)).toBe(false);
});

test('late origin and mutation responses cannot re-enable an older selection', () => {
  const gate = createSourceRequestGate();
  gate.switchSource();
  const originA = gate.begin('origin');
  const mutationA = gate.begin('mutation');
  const originB = gate.begin('origin');
  const mutationB = gate.begin('mutation');

  let originPath: string | null = null;
  if (gate.isCurrent('origin', originB)) originPath = 'B';
  if (gate.isCurrent('origin', originA)) originPath = 'A';

  let restoreEnabled = false;
  if (gate.isCurrent('mutation', mutationB)) restoreEnabled = true;
  if (gate.isCurrent('mutation', mutationA)) restoreEnabled = false;

  expect(originPath).toBe('B');
  expect(restoreEnabled).toBe(true);
  expect(panelSource).toContain("begin('origin')");
  expect(panelSource).toContain("begin('mutation')");
  expect(panelSource).toContain("isCurrent('origin'");
  expect(panelSource).toContain("isCurrent('mutation'");
});

test('switching source invalidates detail responses even when the lane is reused', () => {
  const gate = createSourceRequestGate();
  gate.switchSource();
  const requestA = gate.begin('content');
  gate.switchSource();
  const requestB = gate.begin('content');

  expect(gate.isCurrent('content', requestA)).toBe(false);
  expect(gate.isCurrent('content', requestB)).toBe(true);
});

test('Codex checkpoint mutations stay unavailable in the browser UI', () => {
  expect(panelSource).toContain("const checkpointMutationsSupported = source === 'claude';");
  expect(panelSource).toContain('Save as… and Restore are unavailable for Codex checkpoints.');
  expect(panelSource).toContain('{checkpointMutationsSupported && (');
});
