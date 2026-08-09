import { JSX, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import {
  Clock,
  Filter,
  GitBranch,
  Loader2,
  MessageSquare,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { ParsedFilterChips } from './ParsedFilterChips';

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

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const SearchView = (): JSX.Element => {
  const { openTab, setActiveActivity, query, setQuery } = useStore(
    useShallow((state) => ({
      openTab: state.openTab,
      setActiveActivity: state.setActiveActivity,
      query: state.shellSearchQuery,
      setQuery: state.setShellSearchQuery,
    }))
  );
  const [datePreset, setDatePreset] = useState<DatePreset>('any');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [results, setResults] = useState<FilteredSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [nlMode, setNlMode] = useState(false);
  const [parsed, setParsed] = useState<ParsedNLQuery | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // ponytail: useCallback required — in useEffect dep array
  const runSearch = useCallback(async (q: string, date: DatePreset, status: StatusFilter) => {
    setLoading(true);
    setHasSearched(true);
    try {
      const range = getDateRange(date);
      const filters: SearchFilters = {
        query: q || undefined,
        statusFilter: status === 'all' ? undefined : status,
        minCreatedAt: range.min,
        maxCreatedAt: range.max,
      };
      const response = await api.searchSessionsFiltered(filters, 100);
      setResults(response.results);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (query.trim() || datePreset !== 'any' || statusFilter !== 'all') {
        void runSearch(query, datePreset, statusFilter);
      } else {
        setResults([]);
        setHasSearched(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, datePreset, statusFilter, runSearch]);

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

        {loading && (
          <div className="flex justify-center py-12">
            <Loader2 className="text-muted-foreground size-6 animate-spin" />
          </div>
        )}

        {!loading && results.length > 0 && (
          <div className="space-y-2">
            {results.map((result) => (
              <button
                key={`${result.projectId}/${result.sessionId}`}
                onClick={() => handleResultClick(result)}
                className="border-border hover:bg-card group w-full rounded-xs border p-4 text-left transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground truncate text-sm font-medium">
                      {result.customTitle ?? result.preview ?? 'Untitled session'}
                    </p>
                    {result.preview && result.customTitle && (
                      <p className="text-muted-foreground mt-0.5 truncate text-xs">
                        {result.preview}
                      </p>
                    )}
                  </div>
                  {result.isOngoing && (
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] text-green-400">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-75" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
                      </span>
                      Live
                    </span>
                  )}
                </div>

                <div className="text-muted-foreground mt-2 flex items-center gap-3 text-[11px]">
                  <span className="flex items-center gap-1">
                    <Clock className="size-3" />
                    {formatTimestamp(result.timestamp)}
                  </span>
                  <span className="flex items-center gap-1">
                    <MessageSquare className="size-3" />
                    {result.messageCount} msgs
                  </span>
                  {result.hasSubagents && (
                    <span className="flex items-center gap-1">
                      <GitBranch className="size-3" />
                      Subagents
                    </span>
                  )}
                  {result.agentName && (
                    <span className="border-border rounded-sm border px-1.5 py-0.5 text-[10px]">
                      {result.agentName}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        {!loading && hasSearched && results.length === 0 && (
          <div className="py-16 text-center">
            <Search className="text-muted-foreground mx-auto mb-3 size-8 opacity-50" />
            <p className="text-muted-foreground text-sm">No sessions match your search</p>
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="text-muted-foreground mt-3"
              >
                Clear filters
              </Button>
            )}
          </div>
        )}

        {!hasSearched && (
          <div className="py-16 text-center">
            <Search className="text-muted-foreground mx-auto mb-3 size-8 opacity-50" />
            <p className="text-muted-foreground text-sm">
              Search across all your Claude Code sessions
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              Type a query or use filters to get started
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
