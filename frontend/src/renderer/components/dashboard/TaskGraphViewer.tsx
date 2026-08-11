import { JSX, useEffect, useState } from 'react';
import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { useUIMode } from '@renderer/hooks/useUIMode';
import { cn } from '@renderer/lib/utils';
import { sanitizeSimpleText } from '@renderer/utils/simpleTextSanitizer';
import { formatDistanceToNowStrict } from 'date-fns';
import { CheckCircle2, Circle, GitBranch, Loader2, RefreshCw, Workflow } from 'lucide-react';

import type { TaskGraphMeta, TaskNode } from '@shared/types/api';

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
  const [graphs, setGraphs] = useState<TaskGraphMeta[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'graph' | 'outline'>('graph');

  const loadList = async (): Promise<void> => {
    setListLoading(true);
    setListError(null);
    try {
      const result = await api.listTaskGraphs();
      setGraphs(result);
      setSelectedUuid((current) =>
        current && result.some((g) => g.uuid === current) ? current : (result[0]?.uuid ?? null)
      );
    } catch (err) {
      setListError(errText(err));
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    void loadList();
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-border/50 flex shrink-0 items-start justify-between gap-2 border-b px-4 py-3">
        <div>
          <p className="text-foreground text-sm font-medium">
            {simple ? 'How tasks connect' : 'Task Graph'}
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {simple
              ? 'When Claude splits work between helpers, this shows what ran and in what order.'
              : 'Read-only view of background task state under ~/.claude/tasks. Nothing here writes.'}
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={listLoading} onClick={() => void loadList()}>
          <RefreshCw className={cn('size-3.5', listLoading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {listError && (
        <div
          role="alert"
          className="border-border/50 bg-destructive/10 text-destructive shrink-0 border-b px-4 py-2 text-xs"
        >
          {listError}
        </div>
      )}

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
                {simple
                  ? 'Nothing to show yet. This is normal when Claude has not handed work to a helper.'
                  : 'No active task graphs found under ~/.claude/tasks.'}
              </p>
            </div>
          ) : (
            graphs.map((graph) => (
              <TaskGraphRow
                key={graph.uuid}
                graph={graph}
                simple={simple}
                selected={graph.uuid === selectedUuid}
                onSelect={() => {
                  setSelectedUuid(graph.uuid);
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
              simple={simple}
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
  graph: TaskGraphMeta;
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
      {simple ? sanitizeSimpleText(graph.label?.trim() || 'Task group') : `${graph.uuid.slice(0, 8)}…`}
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
  simple,
  viewMode,
  onViewModeChange,
}: Readonly<{
  uuid: string;
  simple: boolean;
  viewMode: 'graph' | 'outline';
  onViewModeChange: (viewMode: 'graph' | 'outline') => void;
}>): JSX.Element => {
  const [nodes, setNodes] = useState<TaskNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.readTaskGraph(uuid);
        if (!cancelled) setNodes(result);
      } catch {
        if (!cancelled) setError('This task dir is no longer available.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [uuid]);

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
            variant={viewMode === 'outline' ? 'secondary' : 'outline'}
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

const TaskNodeCard = ({ node }: Readonly<{ node: TaskNode }>): JSX.Element => (
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
