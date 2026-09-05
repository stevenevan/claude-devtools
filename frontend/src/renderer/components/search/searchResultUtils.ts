export interface SearchSnippet {
  text: string;
  matchStart: number;
  matchEnd: number;
  truncatedBefore: boolean;
  truncatedAfter: boolean;
}

export function buildSearchSnippet(
  source: string,
  query: string,
  radius = 80
): SearchSnippet {
  const text = source ?? '';
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return {
      text: text.slice(0, radius * 2),
      matchStart: -1,
      matchEnd: -1,
      truncatedBefore: false,
      truncatedAfter: text.length > radius * 2,
    };
  }

  const index = text.toLowerCase().indexOf(needle);
  if (index === -1) {
    return {
      text: text.slice(0, radius * 2),
      matchStart: -1,
      matchEnd: -1,
      truncatedBefore: false,
      truncatedAfter: text.length > radius * 2,
    };
  }

  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + needle.length + radius);
  return {
    text: text.slice(start, end),
    matchStart: index - start,
    matchEnd: index - start + needle.length,
    truncatedBefore: start > 0,
    truncatedAfter: end < text.length,
  };
}

export type SearchScopeId = 'this-project' | 'last-7-days' | 'errors-only';

export interface SearchScope {
  id: SearchScopeId;
  label: string;
  hint: string;
}

export const SEARCH_SCOPES: SearchScope[] = [
  { id: 'this-project', label: 'This project', hint: 'Only the selected project' },
  { id: 'last-7-days', label: 'Last 7 days', hint: 'Sessions from the past week' },
  { id: 'errors-only', label: 'Errors only', hint: 'Sessions with detected errors' },
];

const SEVEN_DAYS_MS = 7 * 86400000;

export function scopeMinCreatedAt(scopeId: SearchScopeId | null, now = Date.now()): number | undefined {
  if (scopeId === 'last-7-days') return now - SEVEN_DAYS_MS;
  return undefined;
}

export interface ScopeFilterContext {
  projectId: string | null;
  errorSessionIds: ReadonlySet<string>;
}

export function applySearchScope<T extends { projectId: string; sessionId: string }>(
  results: readonly T[],
  scopeId: SearchScopeId | null,
  context: ScopeFilterContext
): T[] {
  if (scopeId === 'this-project') {
    if (!context.projectId) return [];
    return results.filter((result) => result.projectId === context.projectId);
  }
  if (scopeId === 'errors-only') {
    return results.filter((result) => context.errorSessionIds.has(result.sessionId));
  }
  return [...results];
}

const RECENT_SEARCHES_KEY = 'claude-devtools-recent-searches';
const MAX_RECENT_SEARCHES = 8;

interface RecentSearchStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

function getBrowserStorage(): RecentSearchStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadRecentQueries(storage: RecentSearchStorage | null = getBrowserStorage()): string[] {
  try {
    const raw = storage?.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string').slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

export function saveRecentQuery(
  query: string,
  storage: RecentSearchStorage | null = getBrowserStorage()
): string[] {
  const cleaned = query.trim();
  if (!cleaned) return loadRecentQueries(storage);
  const next = [cleaned, ...loadRecentQueries(storage).filter((entry) => entry !== cleaned)].slice(
    0,
    MAX_RECENT_SEARCHES
  );
  try {
    storage?.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    return next;
  }
  return next;
}
