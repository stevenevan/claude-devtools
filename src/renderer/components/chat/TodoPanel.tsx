/**
 * TodoPanel - Displays session task list from ~/.claude/todos/{sessionId}.json.
 * Shows as a collapsible sidebar panel within the chat view.
 */

import { useMemo } from 'react';

import { Button } from '@renderer/components/ui/button';
import { parseTodoData } from '@renderer/types/todos';
import { CheckCircle2, Circle, Loader2, ListTodo, X } from 'lucide-react';

import type { TodoItem } from '@renderer/types/todos';

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
  const items = useMemo(() => parseTodoData(todoData), [todoData]);
  const completedCount = items.filter((t) => t.status === 'completed').length;
  const totalCount = items.length;

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
