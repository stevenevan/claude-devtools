import { expect, test } from 'bun:test';

import { sanitizeSimpleText } from './simpleTextSanitizer';

test('redacts absolute paths without changing HTTP URLs or Markdown links', () => {
  const text =
    'Open /Users/alice/private/notes.txt and [docs](https://example.com/docs/file) or https://example.com/docs/file.';

  expect(sanitizeSimpleText(text)).toBe(
    'Open notes.txt and [docs](https://example.com/docs/file) or https://example.com/docs/file.'
  );
});

test('redacts file URLs', () => {
  expect(sanitizeSimpleText('Open file:///Users/alice/private/notes.txt')).toBe('Open notes.txt');
});
