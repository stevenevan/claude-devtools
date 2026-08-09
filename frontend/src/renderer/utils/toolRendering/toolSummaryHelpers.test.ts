import { expect, test } from 'bun:test';

import { getSimpleToolSummary, getToolSummary } from './toolSummaryHelpers';

test('Simple tool summaries use basename-only file names', () => {
  expect(getSimpleToolSummary('Read', { file_path: '/Users/name/project/src/reader.ts' })).toBe(
    'Read reader.ts'
  );
  expect(getSimpleToolSummary('Edit', { file_path: 'C:\\work\\project\\main.ts' })).toBe(
    'Edited main.ts'
  );
  expect(getSimpleToolSummary('Write', { file_path: '/private/tmp/result.txt' })).toBe(
    'Wrote result.txt'
  );
  expect(getSimpleToolSummary('Read', { file_path: '/private/tmp/session.jsonl' })).toBe(
    'Read session file'
  );
  expect(getSimpleToolSummary('Grep', { path: '/Users/name/project/src' })).toBe('Searched src');
  expect(getSimpleToolSummary('Glob', { path: '/Users/name/project' })).toBe(
    'Looked for files in project'
  );
});

test('Simple Bash and unknown summaries never expose tool input', () => {
  const command = 'curl https://secret.example --header Authorization:token';

  expect(getSimpleToolSummary('Bash', { command, description: command })).toBe('Ran a command');
  expect(getSimpleToolSummary('UnknownTool', { command })).toBe('used a tool');
});

test('Simple Task summaries avoid helper prompt content', () => {
  expect(
    getSimpleToolSummary('Task', { prompt: 'Read /private/project/secret.txt', description: 'Secret' })
  ).toBe('Asked a helper for help');
});

test('Nerd tool summaries retain existing detail', () => {
  expect(getToolSummary('Bash', { description: 'Run checks' })).toBe('Run checks');
});
