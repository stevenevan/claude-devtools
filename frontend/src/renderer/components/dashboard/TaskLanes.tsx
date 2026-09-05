import { JSX, useMemo, useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import { VirtualList } from '@renderer/components/common/VirtualList';
import { cn } from '@renderer/lib/utils';
import { sanitizeSimpleText } from '@renderer/utils/simpleTextSanitizer';
import { CheckCircle2, Circle, ListTodo, Loader2 } from 'lucide-react';

import { groupNodesByLane, TASK_LANES } from './taskGraphLanes';

import type { TaskLaneId } from './taskGraphLanes';
import type { TaskNodeData } from '@shared/types/api';

export const STATUS_STYLES: Record<string, { icon: JSX.Element; label: string }> = {
  completed: { icon: <CheckCircle2 className="size-3 text-emerald-400" />, label: 'Completed' },
  in_progress: {
    icon: <Loader2 className="size-3 animate-spin text-blue-400" />,
    label: 'In progress',
  },
  pending: { icon: <Circle className="text-muted-foreground size-3" />, label: 'Pending' },
};

export const StatusBadge = ({ status }: Readonly<{ status: string }>): JSX.Element => {
  const style = STATUS_STYLES[status];
  return (
    <span className="border-border bg-background/50 inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]">
      {style?.icon ?? <Circle className="text-muted-foreground size-3" />}
      <span className="text-foreground">{style?.label ?? status}</span>
    </span>
  );
};

const TASK_LANE_THRESHOLD = 50;

interface TaskLanesProps {
  nodes: TaskNodeData[];
  scrollContainerRef: { current: HTMLElement | null };
}

export const TaskLanes = ({ nodes, scrollContainerRef }: Readonly<TaskLanesProps>): JSX.Element => {
  const groups = useMemo(() => groupNodesByLane(nodes), [nodes]);
  const [expanded, setExpanded] = useState<TaskLaneId>(() => {
    if (groups.now.length > 0) return 'now';
    if (groups.next.length > 0) return 'next';
    return 'done';
  });

  const visible = groups[expanded];
  const lane = TASK_LANES.find((entry) => entry.id === expanded);

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Task status lanes" className="grid grid-cols-3 gap-2">
        {TASK_LANES.map((entry) => {
          const count = groups[entry.id].length;
          const active = expanded === entry.id;
          return (
            <Button
              key={entry.id}
              type="button"
              variant="outline"
              aria-expanded={active}
              aria-controls="task-lane-steps"
              onClick={() => setExpanded(entry.id)}
              className={cn(
                'bg-background/50 flex h-auto flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left transition-colors',
                active && 'border-indigo-500/50 bg-indigo-500/5'
              )}
            >
              <span className="text-foreground text-sm font-semibold tabular-nums">{count}</span>
              <span className="text-foreground text-xs font-medium">{entry.label}</span>
              <span className="text-muted-foreground text-[10px] font-normal">{entry.hint}</span>
            </Button>
          );
        })}
      </div>

      <div id="task-lane-steps">
        <h2 className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-wide uppercase">
          {lane?.label} ({visible.length})
        </h2>
        {visible.length === 0 ? (
          <p className="text-muted-foreground flex items-center gap-2 py-4 text-xs">
            <ListTodo aria-hidden="true" className="size-4 opacity-50" />
            Nothing {expanded === 'done' ? 'finished yet' : expanded === 'now' ? 'running right now' : 'waiting'}.
          </p>
        ) : (
          <VirtualList
            items={visible}
            getItemKey={(node) => node.id}
            estimateSize={() => 64}
            renderItem={(node) => (
              <div className="border-border/60 bg-card flex items-start justify-between gap-2 rounded-md border p-3">
                <span className="text-foreground min-w-0 flex-1 break-words text-xs font-medium">
                  {sanitizeSimpleText(node.subject) || 'Unnamed step'}
                </span>
                <StatusBadge status={node.status} />
              </div>
            )}
            ariaLabel={`${lane?.label} steps`}
            threshold={TASK_LANE_THRESHOLD}
            scrollKey="task-lanes"
            scrollContainerRef={scrollContainerRef}
            rowClassName="pb-2"
          />
        )}
      </div>
    </div>
  );
};
