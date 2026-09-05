import { describe, expect, test } from 'bun:test';

import {
  applySearchScope,
  buildSearchSnippet,
  loadRecentQueries,
  saveRecentQuery,
  scopeMinCreatedAt,
} from './searchResultUtils';

describe('search snippet generation', () => {
  test('windows the excerpt around the first match with ellipsis flags', () => {
    const source = `${'filler '.repeat(30)}needle${' trailer'.repeat(30)}`;
    const snippet = buildSearchSnippet(source, 'needle', 10);

    expect(snippet.text).toContain('needle');
    expect(snippet.text.length).toBeLessThan(source.length);
    expect(snippet.truncatedBefore).toBeTrue();
    expect(snippet.truncatedAfter).toBeTrue();
    expect(snippet.matchStart).toBeGreaterThanOrEqual(0);
    expect(snippet.matchEnd - snippet.matchStart).toBe('needle'.length);
  });

  test('returns the head excerpt when there is no match or query', () => {
    const headless = buildSearchSnippet('plain text', 'missing');
    expect(headless.matchStart).toBe(-1);
    expect(headless.text).toBe('plain text');

    const empty = buildSearchSnippet('plain text', '   ');
    expect(empty.matchStart).toBe(-1);
    expect(empty.text).toBe('plain text');
  });

  test('treats regex characters in the query literally', () => {
    const snippet = buildSearchSnippet('open file (.*) now', '(.*)', 10);
    expect(snippet.matchStart).toBeGreaterThanOrEqual(0);
    expect(snippet.text.slice(snippet.matchStart, snippet.matchEnd)).toBe('(.*)');
  });
});

describe('saved search scopes', () => {
  const rows = [
    { projectId: 'alpha', sessionId: 'session-a' },
    { projectId: 'beta', sessionId: 'session-b' },
  ];

  test('keeps only the selected project', () => {
    expect(
      applySearchScope(rows, 'this-project', { projectId: 'alpha', errorSessionIds: new Set() })
    ).toEqual([rows[0]]);
  });

  test('returns nothing for the project scope without a selection', () => {
    expect(
      applySearchScope(rows, 'this-project', { projectId: null, errorSessionIds: new Set() })
    ).toEqual([]);
  });

  test('keeps only sessions with detected errors', () => {
    expect(
      applySearchScope(rows, 'errors-only', {
        projectId: null,
        errorSessionIds: new Set(['session-b']),
      })
    ).toEqual([rows[1]]);
  });

  test('bounds the last-7-days scope to a week', () => {
    const now = new Date('2026-09-05T00:00:00Z').getTime();
    expect(scopeMinCreatedAt('last-7-days', now)).toBe(now - 7 * 86400000);
    expect(scopeMinCreatedAt(null, now)).toBeUndefined();
    expect(scopeMinCreatedAt('errors-only', now)).toBeUndefined();
  });
});

describe('recent search queries', () => {
  function memoryStorage(): { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void } {
    const values = new Map<string, string>();
    return {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
  }

  test('persists locally with dedupe and a cap', () => {
    const storage = memoryStorage();
    expect(loadRecentQueries(storage)).toEqual([]);

    saveRecentQuery('env', storage);
    saveRecentQuery('auth', storage);
    saveRecentQuery('env', storage);
    expect(loadRecentQueries(storage)).toEqual(['env', 'auth']);

    for (let index = 0; index < 10; index += 1) {
      saveRecentQuery(`query-${index}`, storage);
    }
    const recent = loadRecentQueries(storage);
    expect(recent).toHaveLength(8);
    expect(recent[0]).toBe('query-9');
  });

  test('ignores blank queries and corrupt storage', () => {
    const storage = memoryStorage();
    saveRecentQuery('   ', storage);
    expect(loadRecentQueries(storage)).toEqual([]);

    storage.setItem('claude-devtools-recent-searches', 'not-json');
    expect(loadRecentQueries(storage)).toEqual([]);
  });
});
