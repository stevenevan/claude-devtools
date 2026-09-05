import { JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import {
  Filter,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { ParsedFilterChips } from './ParsedFilterChips';
import { SearchResultCard } from './SearchResultCard';
import {
  SEARCH_SCOPES,
  applySearchScope,
  buildSearchSnippet,
  loadRecentQueries,
  saveRecentQuery,
  scopeMinCreatedAt,
  type SearchScopeId,
} from './searchResultUtils';
import { EmptyState } from '@renderer/components/common/EmptyState';
import { LoadingState } from '@renderer/components/common/LoadingState';

import type { FilteredSearchResult, SearchFilters } from '@shared/types';
import type { ParsedNLQuery } from '@shared/types/api';

type StatusFilter = 'all' | 'ongoing' | 'completed';
type DatePreset = 'any' | 'today' | 'week' | 'month';

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Past 7 days' },
  { value: 'month', label: 'Past 30 days' },
];

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'completed', label: 'Completed' },
];

function getDateRange(preset: DatePreset): { min?: number; max?: number } {
  if (preset === 'any') return {};
  const now = Date.now();
  const day = 86400000;
  switch (preset) {
    case 'today':
      return { min: now - day };
    case 'week':
      return { min: now - 7 * day };
    case 'month':
      return { min: now - 30 * day };
  }
}

export const SearchView = (): JSX.Element => {
  const { openTab, setActiveActivity, query, setQuery, selectedProjectId } = useStore(
    useShallow((state) => ({
      openTab: state.openTab,
      setActiveActivity: state.setActiveActivity,
      query: state.shellSearchQuery,
      setQuery: state.setShellSearchQuery,
      selectedProjectId: state.selectedProjectId,
    }))
  );
  const notifications = useStore((state) => state.notifications);
  const fetchNotifications = useStore((state) => state.fetchNotifications);
  const [datePreset, setDatePreset] = useState<DatePreset>('any');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [activeScope, setActiveScope] = useState<SearchScopeId | null>(null);
  const [recentQueries, setRecentQueries] = useState<string[]>(() => loadRecentQueries());
  const [focusedResult, setFocusedResult] = useState(0);
  const [results, setResults] = useState<FilteredSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [nlMode, setNlMode] = useState(false);
  const [parsed, setParsed] = useState<ParsedNLQuery | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const resultRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const errorSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const alert of notifications) {
      if (alert.sessionId) ids.add(alert.sessionId);
    }
    return ids;
  }, [notifications]);

  // ponytail: useCallback required — in useEffect dep array
  const runSearch = useCallback(
    async (q: string, date: DatePreset, status: StatusFilter, scope: SearchScopeId | null) => {
      setLoading(true);
      setHasSearched(true);
      try {
        const range = getDateRange(date);
        const scopeMin = scopeMinCreatedAt(scope);
        const minCreatedAt =
          range.min !== undefined && scopeMin !== undefined
            ? Math.max(range.min, scopeMin)
            : (range.min ?? scopeMin);
        const filters: SearchFilters = {
          query: q || undefined,
          statusFilter: status === 'all' ? undefined : status,
          minCreatedAt,
          maxCreatedAt: range.max,
        };
        const response = await api.searchSessionsFiltered(filters, 100);
        const scoped = applySearchScope(response.results, scope, {
          projectId: selectedProjectId,
          errorSessionIds,
        });
        setResults(scoped);
        setFocusedResult(0);
        if (q.trim()) setRecentQueries(saveRecentQuery(q));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [selectedProjectId, errorSessionIds]
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (query.trim() || datePreset !== 'any' || statusFilter !== 'all' || activeScope !== null) {
        void runSearch(query, datePreset, statusFilter, activeScope);
      } else {
        setResults([]);
        setHasSearched(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, datePreset, statusFilter, activeScope, runSearch]);

  useEffect(() => {
    if (activeScope === 'errors-only') {
      void fetchNotifications();
    }
  }, [activeScope, fetchNotifications]);

  const toggleScope = (scopeId: SearchScopeId): void => {
    setActiveScope((current) => (current === scopeId ? null : scopeId));
  };

  const handleResultClick = (result: FilteredSearchResult): void => {
    setActiveActivity('projects');
    openTab({
      type: 'session',
      projectId: result.projectId,
      sessionId: result.sessionId,
      label: result.customTitle ?? result.preview ?? 'Session',
      fromSearch: true,
    });
  };

  const clearFilters = (): void => {
    setDatePreset('any');
    setStatusFilter('all');
    setActiveScope(null);
  };

  const hasFilters = datePreset !== 'any' || statusFilter !== 'all';

  return (
    <div className="bg-background flex-1 overflow-auto">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[600px] bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.08),transparent)]"
        aria-hidden="true"
      />

      <div className="relative mx-auto max-w-3xl px-8 py-12">
        <div className="mb-4 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={nlMode}
            onClick={() => {
              const next = !nlMode;
              setNlMode(next);
              if (!next) setParsed(null);
            }}
            className={cn(nlMode && 'border-indigo-500/50 bg-indigo-500/10 text-indigo-300')}
          >
            <Sparkles className="size-3" />
            Natural language
          </Button>
          {hasFilters && (
            <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
              <X className="size-4" />
              Clear filters
            </Button>
          )}
        </div>

        {nlMode && (
          <div className="mb-4 flex flex-col gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                if (!query.trim()) {
                  setParsed(null);
                  return;
                }
                const result = await api.parseNLQuery(query);
                setParsed(result);
                if (result.dateMin !== undefined) {
                  const days = Math.round((Date.now() - result.dateMin) / 86400000);
                  if (days <= 1) setDatePreset('today');
                  else if (days <= 7) setDatePreset('week');
                  else setDatePreset('month');
                }
                if (result.textQuery) setQuery(result.textQuery);
                if (result.hasErrors) setStatusFilter('completed');
              }}
              className="w-fit gap-1"
            >
              <Sparkles className="size-3" />
              Interpret query
            </Button>
            <ParsedFilterChips parsed={parsed} />
          </div>
        )}

        <div className="mb-6 flex flex-wrap items-center gap-2" role="group" aria-label="Saved scopes">
          {SEARCH_SCOPES.map((scope) => (
            <button
              key={scope.id}
              onClick={() => toggleScope(scope.id)}
              aria-pressed={activeScope === scope.id}
              title={scope.hint}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                activeScope === scope.id
                  ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-300'
                  : 'border-border text-muted-foreground hover:border-zinc-500 hover:text-foreground'
              )}
            >
              {scope.label}
            </button>
          ))}
        </div>

        {!hasSearched && recentQueries.length > 0 && (
          <div className="mb-6" role="group" aria-label="Recent searches">
            <p className="text-muted-foreground mb-2 text-xs">Recent searches</p>
            <div className="flex flex-wrap gap-2">
              {recentQueries.map((recent) => (
                <button
                  key={recent}
                  onClick={() => setQuery(recent)}
                  className="border-border text-muted-foreground hover:text-foreground rounded-full border px-3 py-1 text-xs transition-colors"
                >
                  {recent}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <Filter className="text-muted-foreground size-3.5" />

          {DATE_PRESETS.map((preset) => (
            <button
              key={preset.value}
              onClick={() => setDatePreset(preset.value)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                datePreset === preset.value
                  ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-300'
                  : 'border-border text-muted-foreground hover:border-zinc-500 hover:text-foreground'
              )}
            >
              {preset.label}
            </button>
          ))}

          <span className="text-border mx-1">|</span>

          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                statusFilter === opt.value
                  ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-300'
                  : 'border-border text-muted-foreground hover:border-zinc-500 hover:text-foreground'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {hasSearched && (
          <div className="text-muted-foreground mb-4 flex items-center justify-between text-xs">
            <span>
              {loading
                ? 'Searching...'
                : `${results.length} result${results.length !== 1 ? 's' : ''}`}
            </span>
          </div>
        )}

        {loading && <LoadingState label="Searching" rows={5} />}

        {!loading && results.length > 0 && (
          <div
            role="listbox"
            aria-label="Search results"
            className="space-y-2"
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
              event.preventDefault();
              const next =
                event.key === 'ArrowDown'
                  ? Math.min(focusedResult + 1, results.length - 1)
                  : Math.max(focusedResult - 1, 0);
              setFocusedResult(next);
              resultRefs.current[next]?.focus();
            }}
          >
            <p role="status" className="sr-only">
              {results.length} {results.length === 1 ? 'result' : 'results'}, result{' '}
              {focusedResult + 1} of {results.length} selected
            </p>
            {results.map((result, index) => {
              const snippet = buildSearchSnippet(
                result.preview ?? result.customTitle ?? '',
                query,
                90
              );
              return (
                <SearchResultCard
                  key={`${result.projectId}/${result.sessionId}`}
                  title={result.customTitle ?? result.preview ?? 'Untitled session'}
                  snippet={`${snippet.truncatedBefore ? '… ' : ''}${snippet.text}${snippet.truncatedAfter ? ' …' : ''}`}
                  query={query}
                  timestamp={result.timestamp}
                  path={result.projectPath}
                  badges={
                    <>
                      {result.isOngoing && (
                        <span className="flex shrink-0 items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] text-green-400">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-75" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
                          </span>
                          Live
                        </span>
                      )}
                      {result.hasSubagents && (
                        <span className="border-border text-muted-foreground rounded-sm border px-1.5 py-0.5 text-[10px]">
                          Subagents
                        </span>
                      )}
                      {result.agentName && (
                        <span className="border-border text-muted-foreground rounded-sm border px-1.5 py-0.5 text-[10px]">
                          {result.agentName}
                        </span>
                      )}
                    </>
                  }
                  selected={focusedResult === index}
                  role="option"
                  ref={(element) => {
                    resultRefs.current[index] = element;
                  }}
                  onFocus={() => setFocusedResult(index)}
                  onOpen={() => handleResultClick(result)}
                />
              );
            })}
          </div>
        )}

        {!loading && hasSearched && results.length === 0 && (
          <EmptyState
            icon={Search}
            title="No sessions match your search"
            hint={hasFilters ? 'Try clearing the filters below.' : 'Try a different query.'}
            actionLabel={hasFilters ? 'Clear filters' : undefined}
            onAction={hasFilters ? clearFilters : undefined}
          />
        )}

        {!hasSearched && (
          <EmptyState
            icon={Search}
            title="Search across all your Claude Code sessions"
            hint="Type a query or use filters to get started"
          />
        )}
      </div>
    </div>
  );
};
