import { JSX, useEffect, useRef, useState } from 'react';
import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { InspectorSourceSelector } from './InspectorSourceSelector';
import { useUIMode } from '@renderer/hooks/useUIMode';
import { useStore } from '@renderer/store';
import { cn } from '@renderer/lib/utils';
import { sanitizeSimpleText } from '@renderer/utils/simpleTextSanitizer';
import { formatDistanceToNowStrict } from 'date-fns';
import { CheckCircle2, Circle, GitBranch, Loader2, RefreshCw, Workflow } from 'lucide-react';

import type {
  InspectorTaskGraphList,
  InspectorTaskGraphMeta,
  InspectorTaskGraphResult,
  TaskNodeData,
} from '@shared/types/api';

import { TaskOutline } from './TaskOutline';

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Read-only view of ~/.claude/tasks background task-graph state. Master-detail:
// pick a task dir on the left, its nodes render on the right (mirrors
// MarketplaceBrowser.tsx's layout). Task dirs are ephemeral background state
// — a dir can vanish between the list and detail call, so a failed/empty
// detail load shows a friendly message, not a crash. This panel writes
// nothing.
export const TaskGraphViewer = (): JSX.Element => {
  const mode = useUIMode();
  const simple = mode === 'simple';
  const inspectorSource = useStore((state) => state.inspectorSource);
  const inspectorSourceGeneration = useStore((state) => state.inspectorSourceGeneration);
  const inspectorSelectedTaskGraphId = useStore((state) => state.inspectorSelectedTaskGraphId);
  const setInspectorTaskGraphSelection = useStore((state) => state.setInspectorTaskGraphSelection);
  const getInspectorCacheKey = useStore((state) => state.getInspectorCacheKey);
  const getInspectorCache = useStore((state) => state.getInspectorCache);
  const setInspectorCache = useStore((state) => state.setInspectorCache);
  const [graphs, setGraphs] = useState<InspectorTaskGraphMeta[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'graph' | 'outline'>('graph');
  const [capabilityReason, setCapabilityReason] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [refreshGeneration, setRefreshGeneration] = useState(0);
  const requestGenerationRef = useRef(0);

  const loadList = async (forceRefresh = false): Promise<void> => {
    const requestGeneration = ++requestGenerationRef.current;
    const source = inspectorSource;
    const sourceGeneration = inspectorSourceGeneration;
    const isCurrent = (): boolean =>
      requestGeneration === requestGenerationRef.current &&
      useStore.getState().inspectorSource === source &&
      useStore.getState().inspectorSourceGeneration === sourceGeneration;
    setListLoading(true);
    setListError(null);
    setCapabilityReason(null);
    setDiagnostics([]);
    try {
      const cacheKey = getInspectorCacheKey(source, 'taskGraphs');
      const cached = forceRefresh ? undefined : getInspectorCache<InspectorTaskGraphList>(cacheKey);
      const result = cached ?? (await api.listSourceTaskGraphs(source));
      if (!isCurrent()) return;
      if (!cached) setInspectorCache(cacheKey, result);
      setGraphs(result.items);
      setCapabilityReason(
        result.capability.state === 'available' ? null : result.capability.reason
      );
      const diagnostics = result.capability.diagnostics.map((diagnostic) => diagnostic.message);
      if (
        result.capability.state === 'available' &&
        result.capability.reason !== 'Codex task graph data is available'
      ) {
        diagnostics.unshift(result.capability.reason);
      }
      setDiagnostics([...new Set(diagnostics)]);
      setSelectedUuid((current) =>
        inspectorSelectedTaskGraphId && result.items.some((g) => g.id === inspectorSelectedTaskGraphId)
          ? inspectorSelectedTaskGraphId
          : current && result.items.some((g) => g.id === current)
            ? current
            : (result.items[0]?.id ?? null)
      );
    } catch (err) {
      if (isCurrent()) setListError(errText(err));
    } finally {
      if (isCurrent()) setListLoading(false);
    }
  };

  useEffect(() => {
    setSelectedUuid(null);
    void loadList();
  }, [inspectorSource, inspectorSourceGeneration]);

  useEffect(() => {
    if (
      inspectorSelectedTaskGraphId &&
      graphs.some((graph) => graph.id === inspectorSelectedTaskGraphId)
    ) {
      setSelectedUuid(inspectorSelectedTaskGraphId);
    }
  }, [graphs, inspectorSelectedTaskGraphId]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-border/50 flex shrink-0 items-start justify-between gap-2 border-b px-4 py-3">
        <div>
          <p className="text-foreground text-sm font-medium">
            {simple ? 'How tasks connect' : 'Task Graph'}
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {simple && inspectorSource === 'codex'
              ? 'Read-only Codex task state, when compatible task files are available.'
              : simple
                ? 'When Claude splits work between helpers, this shows what ran and in what order.'
              : `Read-only view of background task state under ~/${inspectorSource === 'codex' ? '.codex' : '.claude'}/tasks. Nothing here writes.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <InspectorSourceSelector />
          <Button
            variant="outline"
            size="sm"
            disabled={listLoading}
            onClick={() => {
              setRefreshGeneration((current) => current + 1);
              void loadList(true);
            }}
          >
            <RefreshCw className={cn('size-3.5', listLoading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {listError && (
        <div
          role="alert"
          className="border-border/50 bg-destructive/10 text-destructive shrink-0 border-b px-4 py-2 text-xs"
        >
          {listError}
        </div>
      )}

      {diagnostics.length > 0 ? (
        <div role="status" className="border-border bg-amber-500/10 shrink-0 border-b px-4 py-2">
          <p className="text-amber-500 text-[10px] font-medium">
            Some task graph details need review
          </p>
          <ul className="text-muted-foreground mt-1 list-disc pl-4 text-[10px]">
            {diagnostics.map((diagnostic) => (
              <li key={diagnostic}>{diagnostic}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-1 overflow-hidden">
        <div
          aria-label={simple ? 'Task groups' : 'Task graphs'}
          className="border-border/50 w-64 shrink-0 overflow-y-auto border-r"
        >
          {listLoading ? (
            <p role="status" className="text-muted-foreground px-4 py-3 text-xs">
              Loading…
            </p>
          ) : graphs.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <Workflow className="text-muted-foreground size-6 opacity-50" />
              <p className="text-muted-foreground text-xs">
                {capabilityReason ??
                  (inspectorSource === 'codex'
                    ? 'No compatible Codex task graphs found under ~/.codex/tasks.'
                    : simple
                      ? 'Nothing to show yet. This is normal when Claude has not handed work to a helper.'
                      : 'No active task graphs found under ~/.claude/tasks.')}
              </p>
            </div>
          ) : (
            graphs.map((graph) => (
              <TaskGraphRow
                key={graph.id}
                graph={graph}
                simple={simple}
                selected={graph.id === selectedUuid}
                onSelect={() => {
                  setSelectedUuid(graph.id);
                  setInspectorTaskGraphSelection(graph.id);
                  setViewMode('graph');
                }}
              />
            ))
          )}
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          {selectedUuid ? (
            <TaskGraphDetail
              uuid={selectedUuid}
              sourceKind={inspectorSource}
              simple={simple}
              refreshGeneration={refreshGeneration}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
            />
          ) : (
            <EmptyDetail simple={simple} />
          )}
        </div>
      </div>
    </div>
  );
};

interface TaskGraphRowProps {
  graph: InspectorTaskGraphMeta;
  simple: boolean;
  selected: boolean;
  onSelect: () => void;
}

const TaskGraphRow = ({ graph, simple, selected, onSelect }: Readonly<TaskGraphRowProps>): JSX.Element => (
  <Button
    variant="ghost"
    aria-current={selected || undefined}
    onClick={onSelect}
    className={cn(
      'h-auto w-full min-w-0 flex-col items-start gap-0.5 rounded-none border-b px-4 py-2 text-left',
      selected ? 'bg-card/60' : 'hover:bg-card/30'
    )}
  >
    <span className="text-foreground w-full truncate text-xs font-medium">
      {simple ? sanitizeSimpleText(graph.label?.trim() || 'Task group') : `${graph.id.slice(0, 8)}…`}
    </span>
    <span className="text-muted-foreground w-full truncate text-[10px]">
      {graph.taskCount} task{graph.taskCount === 1 ? '' : 's'} ·{' '}
      {formatDistanceToNowStrict(new Date(graph.latestMtime), { addSuffix: true })}
    </span>
  </Button>
);

const EmptyDetail = ({ simple }: Readonly<{ simple: boolean }>): JSX.Element => (
  <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
    <Workflow className="text-muted-foreground size-6 opacity-50" />
    <p className="text-muted-foreground text-xs">
      {simple ? 'Select a task group to view its steps.' : 'Select a task graph to view its nodes.'}
    </p>
  </div>
);

const TaskGraphDetail = ({
  uuid,
  sourceKind,
  simple,
  refreshGeneration,
  viewMode,
  onViewModeChange,
}: Readonly<{
  uuid: string;
  sourceKind: 'claude' | 'codex';
  simple: boolean;
  refreshGeneration: number;
  viewMode: 'graph' | 'outline';
  onViewModeChange: (viewMode: 'graph' | 'outline') => void;
}>): JSX.Element => {
  const getInspectorCacheKey = useStore((state) => state.getInspectorCacheKey);
  const getInspectorCache = useStore((state) => state.getInspectorCache);
  const setInspectorCache = useStore((state) => state.setInspectorCache);
  const inspectorSourceGeneration = useStore((state) => state.inspectorSourceGeneration);
  const [nodes, setNodes] = useState<TaskNodeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const sourceGeneration = inspectorSourceGeneration;
    const isCurrent = (): boolean =>
      !cancelled &&
      useStore.getState().inspectorSource === sourceKind &&
      useStore.getState().inspectorSourceGeneration === sourceGeneration;
    const run = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const cacheKey = getInspectorCacheKey(
          sourceKind,
          'taskGraph',
          uuid,
          undefined,
          String(refreshGeneration)
        );
        const cached = getInspectorCache<InspectorTaskGraphResult>(cacheKey);
        const result = cached ?? (await api.readSourceTaskGraph(sourceKind, uuid));
        if (!cached) setInspectorCache(cacheKey, result);
        if (isCurrent()) {
          if (result.capability.state !== 'available') {
            setError(result.capability.reason);
            setNodes([]);
          } else {
            setNodes(result.nodes);
          }
        }
      } catch {
        if (isCurrent()) setError('This task dir is no longer available.');
      } finally {
        if (isCurrent()) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [sourceKind, uuid, inspectorSourceGeneration, refreshGeneration]);

  if (loading) {
    return (
      <p role="status" className="text-muted-foreground px-4 py-3 text-xs">
        Loading…
      </p>
    );
  }
  if (error) {
    return (
      <p role="alert" className="text-muted-foreground px-4 py-3 text-xs">
        {error}
      </p>
    );
  }
  if (nodes.length === 0) {
    return (
      <p className="text-muted-foreground px-4 py-3 text-xs">
        This task dir is no longer available.
      </p>
    );
  }

  if (simple || viewMode === 'outline') {
    return <TaskOutline nodes={nodes} simple={simple} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="border-border/60 bg-card/30 flex items-start gap-2 rounded-md border px-3 py-2">
        <GitBranch className="text-muted-foreground mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <p className="text-muted-foreground text-[10px]">
          Nodes are work steps. Edges show which steps must happen before another step.
        </p>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-[10px]">{nodes.length} task steps</p>
        <div role="group" aria-label="Task graph view" className="flex gap-1">
          <Button
            type="button"
            size="xs"
            variant={viewMode === 'graph' ? 'secondary' : 'outline'}
            onClick={() => onViewModeChange('graph')}
          >
            Graph
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => onViewModeChange('outline')}
          >
            Outline
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {nodes.map((node) => (
          <TaskNodeCard key={node.id} node={node} />
        ))}
      </div>
    </div>
  );
};

const STATUS_STYLES: Record<string, { icon: JSX.Element; label: string }> = {
  completed: { icon: <CheckCircle2 className="size-3 text-emerald-400" />, label: 'Completed' },
  in_progress: {
    icon: <Loader2 className="size-3 animate-spin text-blue-400" />,
    label: 'In progress',
  },
  pending: { icon: <Circle className="text-muted-foreground size-3" />, label: 'Pending' },
};

const StatusBadge = ({ status }: Readonly<{ status: string }>): JSX.Element => {
  const style = STATUS_STYLES[status];
  return (
    <span className="border-border bg-background/50 inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]">
      {style?.icon ?? <Circle className="text-muted-foreground size-3" />}
      <span className="text-foreground">{style?.label ?? status}</span>
    </span>
  );
};

const TaskNodeCard = ({ node }: Readonly<{ node: TaskNodeData }>): JSX.Element => (
  <div className="border-border/60 bg-card rounded-md border p-3">
    <div className="mb-1.5 flex items-start justify-between gap-2">
      <span className="text-foreground text-xs font-medium">{node.subject}</span>
      <StatusBadge status={node.status} />
    </div>
    {node.blocks.length > 0 && (
      <p className="text-muted-foreground text-[10px]">Blocks: {node.blocks.join(', ')}</p>
    )}
    {node.blockedBy.length > 0 && (
      <p className="text-muted-foreground text-[10px]">Blocked by: {node.blockedBy.join(', ')}</p>
    )}
  </div>
);
