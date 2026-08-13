import { JSX, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@renderer/api';
import { CopyButton } from '@renderer/components/common/CopyButton';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';
import { cn } from '@renderer/lib/utils';
import { useUIMode } from '@renderer/hooks/useUIMode';
import { useStore } from '@renderer/store';
import { InspectorSourceSelector } from './InspectorSourceSelector';
import { useVirtualizer } from '@tanstack/react-virtual';
import { formatDistanceToNowStrict } from 'date-fns';
import { History as HistoryIcon, Loader2, RefreshCw, Search } from 'lucide-react';

import {
  flattenHistoryEntries,
  getHistoryProjectLabel,
  getHistoryProjectOptions,
} from './historyBrowserHelpers';
import { CodexSessionDetail } from './CodexSessionDetail';

import type { HistoryEntry, InspectorHistoryEntry, InspectorPage } from '@shared/types/api';
import type { HistoryListItem } from './historyBrowserHelpers';
import type { Project } from '@renderer/types/data';

const PAGE_SIZE = 100;
const ROW_HEIGHT = 52;
const HEADING_HEIGHT = 32;
const OVERSCAN = 8;
const SEARCH_DEBOUNCE_MS = 300;
const LOAD_MORE_THRESHOLD = 3;
const ALL_PROJECTS = '__all__';

type DisplayHistoryEntry = HistoryEntry &
  Pick<InspectorHistoryEntry, 'sessionId' | 'source' | 'provenance'>;

const estimateRowSize = (item: HistoryListItem<DisplayHistoryEntry> | undefined): number =>
  item?.type === 'heading' ? HEADING_HEIGHT : ROW_HEIGHT;

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function historyEntryKey(entry: DisplayHistoryEntry): string {
  if (entry.source === 'codex' && entry.provenance.line !== undefined) {
    return `${entry.provenance.sourceFile}:${entry.provenance.line}`;
  }
  return JSON.stringify([
    entry.source,
    entry.sessionId ?? '',
    entry.timestamp,
    entry.project,
    entry.display,
  ]);
}

// Read-only view of ~/.claude/history.jsonl prompt/command history. Pages
// load newest-first via a `before` timestamp cursor (append-safe: a
// positional offset would skip/duplicate rows as the file grows live).
// Search re-queries the backend; the project filter only narrows the
// already-loaded window. This panel writes nothing.
export const HistoryBrowser = (): JSX.Element => {
  const mode = useUIMode();
  const projects = useStore((state) => state.projects);
  const inspectorSource = useStore((state) => state.inspectorSource);
  const inspectorSourceGeneration = useStore((state) => state.inspectorSourceGeneration);
  const getInspectorCacheKey = useStore((state) => state.getInspectorCacheKey);
  const getInspectorCache = useStore((state) => state.getInspectorCache);
  const setInspectorCache = useStore((state) => state.setInspectorCache);
  const [entries, setEntries] = useState<DisplayHistoryEntry[]>([]);
  const [totalMatched, setTotalMatched] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [scanLimited, setScanLimited] = useState(false);

  const [searchInput, setSearchInput] = useState('');
  const [projectFilter, setProjectFilter] = useState(ALL_PROJECTS);
  const [selected, setSelected] = useState<DisplayHistoryEntry | null>(null);

  // Bumped on every search reset so a slow, now-stale page (Tauri `invoke`
  // has no cancellation) can be told apart from the page a fresh query wants.
  const generationRef = useRef(0);
  const parentRef = useRef<HTMLDivElement>(null);

  const mapEntry = (entry: InspectorHistoryEntry): DisplayHistoryEntry => ({
    display: entry.display,
    project: entry.project,
    timestamp: entry.timestamp ?? 0,
    pastedCount: entry.pastedCount,
    sessionId: entry.sessionId,
    source: entry.source,
    provenance: entry.provenance,
  });

  const loadPage = async (
    cursor: string | null,
    query: string | undefined,
    replace: boolean
  ): Promise<void> => {
    const generation = generationRef.current;
    const source = inspectorSource;
    const sourceGeneration = inspectorSourceGeneration;
    const cacheKey = getInspectorCacheKey(source, 'history', undefined, cursor, query);
    const isCurrent = (): boolean =>
      generation === generationRef.current &&
      useStore.getState().inspectorSource === source &&
      useStore.getState().inspectorSourceGeneration === sourceGeneration;
    try {
      const cached = replace
        ? undefined
        : getInspectorCache<InspectorPage<InspectorHistoryEntry>>(cacheKey);
      const page =
        cached ?? (await api.readSourceHistoryPage(source, cursor, PAGE_SIZE, query));
      if (!isCurrent()) return;
      if (!cached) setInspectorCache(cacheKey, page);
      const mappedEntries = page.items.map(mapEntry);
      setEntries((prev) => {
        if (replace) return mappedEntries;
        const existing = new Set(prev.map(historyEntryKey));
        return [...prev, ...mappedEntries.filter((entry) => !existing.has(historyEntryKey(entry)))];
      });
      setTotalMatched(page.totalMatched ?? 0);
      setHasMore(page.hasMore);
      setNextCursor(page.nextCursor);
      setDiagnostics((current) =>
        replace
          ? page.diagnostics.map((diagnostic) => diagnostic.message)
          : [
              ...current,
              ...page.diagnostics
                .map((diagnostic) => diagnostic.message)
                .filter((message) => !current.includes(message)),
            ]
      );
      setScanLimited((current) => (replace ? page.scanLimited : current || page.scanLimited));
    } catch (err) {
      if (!isCurrent()) return;
      setError(errText(err));
    } finally {
      if (!isCurrent()) return;
      if (replace) setLoading(false);
      else setLoadingMore(false);
    }
  };

  useEffect(() => {
    generationRef.current += 1;
    setLoading(true);
    setError(null);
    setSelected(null);
    setProjectFilter(ALL_PROJECTS);
    setDiagnostics([]);
    setScanLimited(false);

    const trimmed = searchInput.trim();
    const handle = setTimeout(() => {
      void loadPage(null, trimmed || undefined, true);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput, inspectorSource, inspectorSourceGeneration]);

  const refresh = (): void => {
    generationRef.current += 1;
    setLoading(true);
    setError(null);
    setSelected(null);
    setNextCursor(null);
    setDiagnostics([]);
    setScanLimited(false);
    void loadPage(null, searchInput.trim() || undefined, true);
  };

  const projectOptions = useMemo(
    () => getHistoryProjectOptions(entries, projects, mode),
    [entries, mode, projects]
  );

  const filteredEntries = useMemo(() => {
    if (projectFilter === ALL_PROJECTS) return entries;
    return entries.filter((entry) => entry.project === projectFilter);
  }, [entries, projectFilter]);

  const historyItems = useMemo(() => flattenHistoryEntries(filteredEntries), [filteredEntries]);

  const rowVirtualizer = useVirtualizer({
    count: historyItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => estimateRowSize(historyItems[index]),
    getItemKey: (index) => historyItems[index]?.id ?? index,
    measureElement: (element) => element.getBoundingClientRect().height,
    overscan: OVERSCAN,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualRowsLength = virtualRows.length;

  useEffect(() => {
    if (virtualRowsLength === 0 || !hasMore || loading || loadingMore) return;
    const lastRow = virtualRows[virtualRowsLength - 1];
    if (!lastRow || lastRow.index < historyItems.length - LOAD_MORE_THRESHOLD) return;
    if (!nextCursor) return;

    setLoadingMore(true);
    void loadPage(nextCursor, searchInput.trim() || undefined, false);
  }, [
    virtualRows,
    virtualRowsLength,
    historyItems.length,
    hasMore,
    loading,
    loadingMore,
    entries,
    nextCursor,
    searchInput,
    inspectorSource,
    inspectorSourceGeneration,
  ]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-border/50 flex shrink-0 items-start justify-between gap-2 border-b px-4 py-3">
        <div>
          <p className="text-foreground text-sm font-medium">
            {mode === 'simple' ? 'Things you asked' : 'History'}
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {mode === 'simple'
              ? 'Prompts you have written are saved here for reuse.'
              : `Read-only view of prompt and command history captured under ~/${inspectorSource === 'codex' ? '.codex' : '.claude'}/history.jsonl. Nothing here writes.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <InspectorSourceSelector />
          <Button variant="outline" size="sm" disabled={loading} onClick={refresh}>
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="border-border/50 flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <div className="relative w-64">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            type="text"
            aria-label="Search prompts and projects"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={mode === 'simple' ? 'Search what you asked...' : 'Search prompts and projects...'}
            className="border-border bg-card text-foreground placeholder:text-muted-foreground focus:ring-ring/30 w-full rounded-md border py-1.5 pr-2 pl-8 text-xs outline-none focus:ring-1"
          />
        </div>

        <Select value={projectFilter} onValueChange={(value) => setProjectFilter(value ?? ALL_PROJECTS)}>
          <SelectTrigger size="sm" className="min-w-40">
            <SelectValue placeholder={mode === 'simple' ? 'All folders' : 'All projects'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_PROJECTS}>
              {mode === 'simple' ? 'All folders' : 'All projects'}
            </SelectItem>
            {projectOptions.map((project) => (
              <SelectItem key={project.value} value={project.value}>
                {project.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-muted-foreground ml-auto text-[11px]">
          {totalMatched.toLocaleString()} matched
        </span>
      </div>

      {error && (
        <div
          role="alert"
          className="border-border/50 bg-destructive/10 text-destructive shrink-0 border-b px-4 py-2 text-xs"
        >
          {error}
        </div>
      )}

      {diagnostics.length > 0 ? (
        <div role="status" className="border-border/50 bg-amber-500/10 shrink-0 border-b px-4 py-2 text-xs">
          <p className="text-amber-500 font-medium">History read warnings</p>
          <ul className="text-muted-foreground mt-1 list-disc pl-4 text-[10px]">
            {diagnostics.map((diagnostic) => <li key={diagnostic}>{diagnostic}</li>)}
          </ul>
        </div>
      ) : null}
      {scanLimited ? (
        <p role="status" className="text-muted-foreground border-border/50 shrink-0 border-b px-4 py-2 text-[10px]">
          History scanning stopped at the read safety limit.
        </p>
      ) : null}

      <div className="flex flex-1 overflow-hidden">
        <div
          ref={parentRef}
          aria-label="History entries"
          className="border-border/50 flex-1 overflow-y-auto border-r"
        >
          {loading && entries.length === 0 ? (
            <p role="status" className="text-muted-foreground px-4 py-3 text-xs">
              Loading…
            </p>
          ) : filteredEntries.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <HistoryIcon className="text-muted-foreground size-6 opacity-50" />
              <p className="text-muted-foreground text-xs">
                {entries.length === 0
                  ? mode === 'simple'
                    ? `Nothing here yet. Use ${inspectorSource === 'codex' ? 'Codex' : 'Claude Code'} to create history entries.`
                    : `No ${inspectorSource === 'codex' ? 'Codex' : 'Claude'} history entries found.`
                  : mode === 'simple'
                    ? 'Nothing found. Try a different word, or clear the folder filter.'
                    : 'No entries match this project filter.'}
              </p>
            </div>
          ) : (
            <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
              {virtualRows.map((virtualRow) => {
                const item = historyItems[virtualRow.index];
                if (!item) return null;
                return (
                  <div
                    key={virtualRow.key}
                    ref={rowVirtualizer.measureElement}
                    data-index={virtualRow.index}
                    className="absolute top-0 left-0 w-full"
                    style={{
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    {item.type === 'heading' ? (
                      <HistoryHeading label={item.label} />
                    ) : (
                      <HistoryRow
                        entry={item.entry}
                        mode={mode}
                        projects={projects}
                        selected={selected === item.entry}
                        onSelect={() => setSelected(item.entry)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {loadingMore && (
            <div
              role="status"
              className="text-muted-foreground flex items-center justify-center gap-1.5 py-2 text-xs"
            >
              <Loader2 className="size-3 animate-spin" />
              Loading more…
            </div>
          )}
        </div>

        <div className="w-96 shrink-0">
          <HistoryDetail entry={selected} mode={mode} projects={projects} />
        </div>
      </div>
    </div>
  );
};

interface HistoryRowProps {
  entry: DisplayHistoryEntry;
  mode: 'simple' | 'nerd';
  projects: readonly Project[];
  selected: boolean;
  onSelect: () => void;
}

const HistoryHeading = ({ label }: Readonly<{ label: string }>): JSX.Element => (
  <h2 className="text-muted-foreground flex h-8 items-center border-b border-border/40 px-4 text-[10px] font-medium uppercase tracking-wider">
    {label}
  </h2>
);

const HistoryRow = ({
  entry,
  mode,
  projects,
  selected,
  onSelect,
}: Readonly<HistoryRowProps>): JSX.Element => {
  const preview = entry.display.replace(/\s+/g, ' ').trim();
  const projectLabel = getHistoryProjectLabel(entry.project, projects, mode);
  const dateLabel =
    mode === 'simple'
      ? formatDistanceToNowStrict(new Date(entry.timestamp), { addSuffix: true })
      : new Date(entry.timestamp).toLocaleString();
  const copyLabel = `Copy prompt: ${preview || 'empty prompt'}`;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={selected || undefined}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'group border-border/40 flex min-h-[52px] w-full min-w-0 cursor-pointer items-center gap-2 border-b px-4 py-2 text-left transition-colors',
        selected ? 'bg-card/60' : 'hover:bg-card/30'
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-foreground truncate text-xs">{preview || '(empty prompt)'}</p>
        <p className="text-muted-foreground mt-0.5 truncate text-[10px]">
          {projectLabel} · {dateLabel}
          {entry.pastedCount > 0 &&
            ` · ${entry.pastedCount} paste${entry.pastedCount === 1 ? '' : 's'}`}
        </p>
      </div>
      <div
        className={cn(
          'shrink-0 transition-opacity',
          mode === 'nerd'
            ? 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
            : 'opacity-100'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <CopyButton text={entry.display} label={copyLabel} inline />
      </div>
    </div>
  );
};

const HistoryDetail = ({
  entry,
  mode,
  projects,
}: Readonly<{
  entry: DisplayHistoryEntry | null;
  mode: 'simple' | 'nerd';
  projects: readonly Project[];
}>): JSX.Element => {
  if (!entry) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <HistoryIcon className="text-muted-foreground size-6 opacity-50" />
        <p className="text-muted-foreground text-xs">Select an entry to view its full prompt.</p>
      </div>
    );
  }
  if (entry.source === 'codex' && entry.sessionId) {
    return <CodexSessionDetail sessionId={entry.sessionId} />;
  }
  const projectLabel = getHistoryProjectLabel(entry.project, projects, mode);
  const dateLabel =
    mode === 'simple'
      ? formatDistanceToNowStrict(new Date(entry.timestamp), { addSuffix: true })
      : new Date(entry.timestamp).toLocaleString();
  const copyLabel = `Copy prompt: ${entry.display.replace(/\s+/g, ' ').trim() || 'empty prompt'}`;

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-foreground truncate text-xs font-medium">{projectLabel}</p>
          <p className="text-muted-foreground mt-0.5 text-[10px]">
            {dateLabel}
            {entry.pastedCount > 0 &&
              ` · ${entry.pastedCount} paste${entry.pastedCount === 1 ? '' : 's'}`}
          </p>
        </div>
        <CopyButton text={entry.display} label={copyLabel} inline />
      </div>
      <pre className="text-foreground border-border bg-card/40 flex-1 overflow-auto rounded-md border p-3 text-xs whitespace-pre-wrap break-words">
        {entry.display}
      </pre>
    </div>
  );
};
