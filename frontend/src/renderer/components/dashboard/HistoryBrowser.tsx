import { JSX, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@renderer/api';
import { CopyButton } from '@renderer/components/common/CopyButton';
import { Button } from '@renderer/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';
import { cn } from '@renderer/lib/utils';
import { useVirtualizer } from '@tanstack/react-virtual';
import { History as HistoryIcon, Loader2, RefreshCw, Search } from 'lucide-react';

import type { HistoryEntry } from '@shared/types/api';

const PAGE_SIZE = 100;
const ROW_HEIGHT = 52;
const OVERSCAN = 8;
const SEARCH_DEBOUNCE_MS = 300;
const LOAD_MORE_THRESHOLD = 3;
const ALL_PROJECTS = '__all__';

const estimateRowSize = (): number => ROW_HEIGHT;

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Read-only view of ~/.claude/history.jsonl prompt/command history. Pages
// load newest-first via a `before` timestamp cursor (append-safe: a
// positional offset would skip/duplicate rows as the file grows live).
// Search re-queries the backend; the project filter only narrows the
// already-loaded window. This panel writes nothing.
export const HistoryBrowser = (): JSX.Element => {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [totalMatched, setTotalMatched] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [projectFilter, setProjectFilter] = useState(ALL_PROJECTS);
  const [selected, setSelected] = useState<HistoryEntry | null>(null);

  // Bumped on every search reset so a slow, now-stale page (Tauri `invoke`
  // has no cancellation) can be told apart from the page a fresh query wants.
  const generationRef = useRef(0);
  const isFirstRenderRef = useRef(true);
  const parentRef = useRef<HTMLDivElement>(null);

  const loadPage = async (
    before: number | null,
    query: string | undefined,
    replace: boolean
  ): Promise<void> => {
    const generation = generationRef.current;
    try {
      const page = await api.readHistoryPage(before, PAGE_SIZE, query);
      if (generation !== generationRef.current) return;
      setEntries((prev) => (replace ? page.entries : [...prev, ...page.entries]));
      setTotalMatched(page.totalMatched);
      setHasMore(page.hasMore);
    } catch (err) {
      if (generation !== generationRef.current) return;
      setError(errText(err));
    } finally {
      if (generation !== generationRef.current) return;
      if (replace) setLoading(false);
      else setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      void loadPage(null, undefined, true);
      return;
    }

    generationRef.current += 1;
    setLoading(true);
    setError(null);
    setSelected(null);
    setProjectFilter(ALL_PROJECTS);

    const trimmed = searchInput.trim();
    const handle = setTimeout(() => {
      void loadPage(null, trimmed || undefined, true);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const refresh = (): void => {
    generationRef.current += 1;
    setLoading(true);
    setError(null);
    setSelected(null);
    void loadPage(null, searchInput.trim() || undefined, true);
  };

  const projectOptions = useMemo(() => {
    const set = new Set<string>();
    for (const entry of entries) set.add(entry.project);
    return Array.from(set).sort();
  }, [entries]);

  const filteredEntries = useMemo(() => {
    if (projectFilter === ALL_PROJECTS) return entries;
    return entries.filter((entry) => entry.project === projectFilter);
  }, [entries, projectFilter]);

  const rowVirtualizer = useVirtualizer({
    count: filteredEntries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: estimateRowSize,
    overscan: OVERSCAN,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualRowsLength = virtualRows.length;

  useEffect(() => {
    if (virtualRowsLength === 0 || !hasMore || loading || loadingMore) return;
    const lastRow = virtualRows[virtualRowsLength - 1];
    if (!lastRow || lastRow.index < filteredEntries.length - LOAD_MORE_THRESHOLD) return;
    const oldestLoaded = entries[entries.length - 1];
    if (!oldestLoaded) return;

    setLoadingMore(true);
    void loadPage(oldestLoaded.timestamp, searchInput.trim() || undefined, false);
  }, [
    virtualRows,
    virtualRowsLength,
    filteredEntries.length,
    hasMore,
    loading,
    loadingMore,
    entries,
    searchInput,
  ]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-border/50 flex shrink-0 items-start justify-between gap-2 border-b px-4 py-3">
        <div>
          <p className="text-foreground text-sm font-medium">History</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Read-only view of prompt and command history captured under ~/.claude/history.jsonl.
            Nothing here writes.
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={loading} onClick={refresh}>
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      <div className="border-border/50 flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <div className="relative w-64">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search prompts and projects..."
            className="border-border bg-card text-foreground placeholder:text-muted-foreground focus:ring-ring/30 w-full rounded-md border py-1.5 pr-2 pl-8 text-xs outline-none focus:ring-1"
          />
        </div>

        <Select value={projectFilter} onValueChange={(value) => setProjectFilter(value ?? ALL_PROJECTS)}>
          <SelectTrigger size="sm" className="min-w-40">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_PROJECTS}>All projects</SelectItem>
            {projectOptions.map((project) => (
              <SelectItem key={project} value={project}>
                {project}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-muted-foreground ml-auto text-[11px]">
          {totalMatched.toLocaleString()} matched
        </span>
      </div>

      {error && (
        <div className="border-border/50 bg-destructive/10 text-destructive shrink-0 border-b px-4 py-2 text-xs">
          {error}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div ref={parentRef} className="border-border/50 flex-1 overflow-y-auto border-r">
          {loading && entries.length === 0 ? (
            <p className="text-muted-foreground px-4 py-3 text-xs">Loading…</p>
          ) : filteredEntries.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <HistoryIcon className="text-muted-foreground size-6 opacity-50" />
              <p className="text-muted-foreground text-xs">
                {entries.length === 0
                  ? 'No history entries found.'
                  : 'No entries match this project filter.'}
              </p>
            </div>
          ) : (
            <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
              {virtualRows.map((virtualRow) => {
                const entry = filteredEntries[virtualRow.index];
                if (!entry) return null;
                return (
                  <div
                    key={virtualRow.key}
                    className="absolute top-0 left-0 w-full"
                    style={{
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <HistoryRow
                      entry={entry}
                      selected={selected === entry}
                      onSelect={() => setSelected(entry)}
                    />
                  </div>
                );
              })}
            </div>
          )}
          {loadingMore && (
            <div className="text-muted-foreground flex items-center justify-center gap-1.5 py-2 text-xs">
              <Loader2 className="size-3 animate-spin" />
              Loading more…
            </div>
          )}
        </div>

        <div className="w-96 shrink-0">
          <HistoryDetail entry={selected} />
        </div>
      </div>
    </div>
  );
};

interface HistoryRowProps {
  entry: HistoryEntry;
  selected: boolean;
  onSelect: () => void;
}

const HistoryRow = ({ entry, selected, onSelect }: Readonly<HistoryRowProps>): JSX.Element => {
  const preview = entry.display.replace(/\s+/g, ' ').trim();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'group border-border/40 flex h-full w-full min-w-0 cursor-pointer items-center gap-2 border-b px-4 py-2 text-left transition-colors',
        selected ? 'bg-card/60' : 'hover:bg-card/30'
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-foreground truncate text-xs">{preview || '(empty prompt)'}</p>
        <p className="text-muted-foreground mt-0.5 truncate text-[10px]">
          {entry.project} · {new Date(entry.timestamp).toLocaleString()}
          {entry.pastedCount > 0 &&
            ` · ${entry.pastedCount} paste${entry.pastedCount === 1 ? '' : 's'}`}
        </p>
      </div>
      <div
        className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <CopyButton text={entry.display} inline />
      </div>
    </div>
  );
};

const HistoryDetail = ({ entry }: Readonly<{ entry: HistoryEntry | null }>): JSX.Element => {
  if (!entry) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <HistoryIcon className="text-muted-foreground size-6 opacity-50" />
        <p className="text-muted-foreground text-xs">Select an entry to view its full prompt.</p>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-foreground truncate text-xs font-medium">{entry.project}</p>
          <p className="text-muted-foreground mt-0.5 text-[10px]">
            {new Date(entry.timestamp).toLocaleString()}
            {entry.pastedCount > 0 &&
              ` · ${entry.pastedCount} paste${entry.pastedCount === 1 ? '' : 's'}`}
          </p>
        </div>
        <CopyButton text={entry.display} inline />
      </div>
      <pre className="text-foreground border-border bg-card/40 flex-1 overflow-auto rounded-md border p-3 text-xs whitespace-pre-wrap break-words">
        {entry.display}
      </pre>
    </div>
  );
};
