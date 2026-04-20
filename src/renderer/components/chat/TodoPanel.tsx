/**
 * TodoPanel - Displays session task list from ~/.claude/todos/{sessionId}.json.
 * Shows as a collapsible sidebar panel within the chat view.
 */

import { useMemo, useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import { parseTodoData } from '@renderer/types/todos';
import { CheckCircle2, Circle, Loader2, ListTodo, X } from 'lucide-react';

import type { TodoItem } from '@renderer/types/todos';

type StatusFilter = 'all' | TodoItem['status'];

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'in_progress', label: 'Active' },
  { id: 'completed', label: 'Done' },
];

interface TodoPanelProps {
  todoData: unknown;
  onClose: () => void;
}

const statusIcon: Record<TodoItem['status'], React.ReactNode> = {
  completed: <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />,
  in_progress: <Loader2 className="size-4 shrink-0 animate-spin text-blue-400" />,
  pending: <Circle className="size-4 shrink-0 text-text-muted" />,
};

const statusLabel: Record<TodoItem['status'], string> = {
  completed: 'Done',
  in_progress: 'In Progress',
  pending: 'Pending',
};

export const TodoPanel = ({ todoData, onClose }: Readonly<TodoPanelProps>): React.JSX.Element => {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const allItems = useMemo(() => parseTodoData(todoData), [todoData]);
  const completedCount = allItems.filter((t) => t.status === 'completed').length;
  const totalCount = allItems.length;
  const items = useMemo(
    () => (statusFilter === 'all' ? allItems : allItems.filter((t) => t.status === statusFilter)),
    [allItems, statusFilter]
  );

  if (totalCount === 0) {
    return (
      <div className="flex h-full flex-col bg-surface-sidebar">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <ListTodo className="size-4 text-text-secondary" />
            <span className="text-sm font-medium text-text">Tasks</span>
          </div>
          <Button variant="ghost" size="icon-xs" onClick={onClose}>
            <X className="size-3.5" />
          </Button>
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-sm text-text-muted">No tasks in this session</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface-sidebar">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <ListTodo className="size-4 text-text-secondary" />
          <span className="text-sm font-medium text-text">Tasks</span>
          <span className="rounded-full bg-surface-raised px-1.5 py-0.5 text-xs text-text-muted">
            {completedCount}/{totalCount}
          </span>
        </div>
        <Button variant="ghost" size="icon-xs" onClick={onClose} title="Close" aria-label="Close tasks panel">
          <X className="size-3.5" />
        </Button>
      </div>

      {/* Progress bar */}
      <div className="border-b border-border px-3 py-2">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-raised">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${(completedCount / totalCount) * 100}%` }}
          />
        </div>
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
        {FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            onClick={() => setStatusFilter(filter.id)}
            className={cn(
              'rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors',
              statusFilter === filter.id
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-background text-text-muted hover:bg-surface-raised'
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto">
        {items.map((item, index) => (
          <div
            key={index}
            className="flex items-start gap-2.5 border-b border-border-subtle px-3 py-2.5"
          >
            {statusIcon[item.status]}
            <div className="min-w-0 flex-1">
              <p
                className={`text-sm leading-snug ${
                  item.status === 'completed' ? 'text-text-muted line-through' : 'text-text'
                }`}
              >
                {item.content}
              </p>
              {item.status === 'in_progress' && item.activeForm && (
                <p className="mt-0.5 text-xs text-blue-400">{item.activeForm}</p>
              )}
            </div>
            <span
              className={`shrink-0 text-xs ${
                item.status === 'completed'
                  ? 'text-emerald-400/70'
                  : item.status === 'in_progress'
                    ? 'text-blue-400/70'
                    : 'text-text-muted'
              }`}
            >
              {statusLabel[item.status]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
