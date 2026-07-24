import { expect, test } from 'bun:test';

import { parseCommandFrontmatter, serializeCommandFrontmatter } from './commandFrontmatter';

test('round-trips all 6 known keys plus an unknown key without dropping it', () => {
  const raw = [
    '---',
    'description: "Do the thing"',
    'argument-hint: <target>',
    'allowed-tools: Read, Bash',
    'model: sonnet',
    'disable-model-invocation: true',
    'user-invocable: false',
    'x-custom: hi',
    '---',
    'Body text here.',
    '',
  ].join('\n');

  const parsed = parseCommandFrontmatter(raw);
  expect(parsed.hasFrontmatter).toBe(true);
  expect(parsed.fields.description).toBe('Do the thing');
  expect(parsed.fields.argumentHint).toBe('<target>');
  expect(parsed.fields.allowedTools).toBe('Read, Bash');
  expect(parsed.fields.model).toBe('sonnet');
  expect(parsed.fields.disableModelInvocation).toBe(true);
  expect(parsed.fields.userInvocable).toBe(false);
  expect(parsed.unknownLines).toContain('x-custom: hi');

  const edited = { ...parsed.fields, description: 'Do the new thing' };
  const out = serializeCommandFrontmatter(edited, parsed.unknownLines, parsed.body);

  expect(out).toContain('description: Do the new thing');
  expect(out).toContain('x-custom: hi');
  expect(out).toContain('Body text here.');
});

test('a file with no frontmatter round-trips byte-identical, no fence injected', () => {
  const raw = '# Just a plain command\n\nNo frontmatter here.\n';

  const parsed = parseCommandFrontmatter(raw);
  expect(parsed.hasFrontmatter).toBe(false);
  expect(parsed.body).toBe(raw);

  const out = serializeCommandFrontmatter(parsed.fields, parsed.unknownLines, parsed.body);
  expect(out).toBe(raw);
});

test('allowed-tools as a YAML list is preserved verbatim, never coerced to a string', () => {
  const raw = ['---', 'description: hi', 'allowed-tools:', '  - Read', '  - Bash', '---', 'Body'].join(
    '\n'
  );

  const parsed = parseCommandFrontmatter(raw);
  expect(parsed.fields.allowedToolsIsComplex).toBe(true);
  expect(parsed.fields.allowedTools).toBeUndefined();
  expect(parsed.unknownLines).toEqual(['allowed-tools:', '  - Read', '  - Bash']);

  const out = serializeCommandFrontmatter(parsed.fields, parsed.unknownLines, parsed.body);
  expect(out).toContain('allowed-tools:\n  - Read\n  - Bash');
});

test('a structured value with an embedded newline or ": " does not create a spurious key', () => {
  expect(() => serializeCommandFrontmatter({ description: 'line one\nline two' }, [], 'body')).toThrow();

  const out = serializeCommandFrontmatter({ description: 'note: important' }, [], 'body');
  const fenceLines = out.split('\n');
  // The colon-space must stay inside the quoted scalar, not open a new key.
  expect(fenceLines).toContain('description: "note: important"');
  expect(fenceLines.some((l) => l.trim() === 'important"')).toBe(false);
});
