import { JSX, useMemo, useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import {
  conversationSubjectKey,
  useConversationSubjects,
  type ConversationSubjectLookup,
} from '@renderer/hooks/useConversationSubjects';
import { cn } from '@renderer/lib/utils';
import { parseTodoData } from '@renderer/types/todos';
import { sanitizeSimpleText } from '@renderer/utils/simpleTextSanitizer';
import { formatDistanceStrict, startOfDay } from 'date-fns';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';

import type { AggregatedSessionTodos } from '@shared/types';
import type { TodoItem } from '@renderer/types/todos';

const FALLBACK_PROJECT_LABEL = 'Folder';
const FALLBACK_CONVERSATION_SUBJECT = 'Untitled conversation';

type SimpleTaskGroupId = 'happening-now' | 'waiting' | 'recently-done';

export interface SimpleTask {
  key: string;
  projectId: string;
  sessionId: string;
  content: string;
  status: TodoItem['status'];
  updatedAt: number;
}

export interface SimpleTaskGroups {
  happeningNow: SimpleTask[];
  waiting: SimpleTask[];
  recentlyDone: SimpleTask[];
  earlierCompleted: SimpleTask[];
}

interface TaskListProps {
  todos: readonly AggregatedSessionTodos[];
  loading: boolean;
  error: string | null;
  projectNames: ReadonlyMap<string, string>;
  onOpenConversation: (projectId: string, sessionId: string) => void;
}

interface TaskGroupSectionProps {
  id: SimpleTaskGroupId;
  title: string;
  tasks: readonly SimpleTask[];
  earlierTasks?: readonly SimpleTask[];
  conversationSubjects: ConversationSubjectLookup;
  projectNames: ReadonlyMap<string, string>;
  onOpenConversation: (projectId: string, sessionId: string) => void;
}

function isUpdatedToday(updatedAt: number, now: number): boolean {
  if (!Number.isFinite(updatedAt)) return false;
  return updatedAt >= startOfDay(new Date(now)).getTime();
}

export function flattenSimpleTasks(
  snapshots: readonly AggregatedSessionTodos[],
  now = Date.now()
): SimpleTaskGroups {
  const groups: SimpleTaskGroups = {
    happeningNow: [],
    waiting: [],
    recentlyDone: [],
    earlierCompleted: [],
  };
  const occurrences = new Map<string, number>();

  for (const snapshot of snapshots) {
    for (const item of parseTodoData(snapshot.items)) {
      const identity = `${snapshot.projectId}\0${snapshot.sessionId}\0${item.status}\0${item.content}`;
      const occurrence = (occurrences.get(identity) ?? 0) + 1;
      occurrences.set(identity, occurrence);
      const task: SimpleTask = {
        key: `${identity}\0${occurrence}`,
        projectId: snapshot.projectId,
        sessionId: snapshot.sessionId,
        content: sanitizeSimpleText(item.content),
        status: item.status,
        updatedAt: snapshot.updatedAt,
      };

      if (item.status === 'in_progress') {
        groups.happeningNow.push(task);
      } else if (item.status === 'pending') {
        groups.waiting.push(task);
      } else if (isUpdatedToday(snapshot.updatedAt, now)) {
        groups.recentlyDone.push(task);
      } else {
        groups.earlierCompleted.push(task);
      }
    }
  }

  return groups;
}

export function formatTaskUpdatedAt(updatedAt: number, now = Date.now()): string {
  if (!Number.isFinite(updatedAt) || !Number.isFinite(now)) return 'updated time unavailable';

  const updatedDate = new Date(updatedAt);
  const nowDate = new Date(now);
  if (Number.isNaN(updatedDate.getTime()) || Number.isNaN(nowDate.getTime())) {
    return 'updated time unavailable';
  }

  return `updated ${formatDistanceStrict(updatedDate, nowDate, { addSuffix: true })}`;
}

export function getTaskConversationLabel(
  task: Pick<SimpleTask, 'projectId' | 'sessionId'>,
  conversationSubjects: ConversationSubjectLookup,
  projectNames: ReadonlyMap<string, string>
): string {
  const subject = conversationSubjects.get(
    conversationSubjectKey({ projectId: task.projectId, sessionId: task.sessionId })
  );
  const projectName = projectNames.get(task.projectId);
  const label = subject && subject !== FALLBACK_CONVERSATION_SUBJECT ? subject : projectName;
  return sanitizeSimpleText(label?.trim() || FALLBACK_PROJECT_LABEL);
}

function getTaskDateTime(updatedAt: number): string | undefined {
  if (!Number.isFinite(updatedAt)) return undefined;
  const date = new Date(updatedAt);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function TaskStatusMark({ status }: Readonly<{ status: TodoItem['status'] }>): JSX.Element {
  if (status === 'in_progress') {
    return <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin text-blue-400" />;
  }
  if (status === 'completed') {
    return <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-emerald-400" />;
  }
  return <Circle aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />;
}

function taskStatusLabel(status: TodoItem['status']): string {
  if (status === 'in_progress') return 'Happening now';
  if (status === 'pending') return 'Waiting';
  return 'Done';
}

function TaskRow({
  task,
  conversationSubjects,
  projectNames,
  onOpenConversation,
}: Readonly<{
  task: SimpleTask;
  conversationSubjects: ConversationSubjectLookup;
  projectNames: ReadonlyMap<string, string>;
  onOpenConversation: (projectId: string, sessionId: string) => void;
}>): JSX.Element {
  const conversationLabel = getTaskConversationLabel(task, conversationSubjects, projectNames);
  const updatedLabel = formatTaskUpdatedAt(task.updatedAt);
  const displayContent = task.content || 'Unnamed task';
  const dateTime = getTaskDateTime(task.updatedAt);

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => onOpenConversation(task.projectId, task.sessionId)}
      aria-label={`${taskStatusLabel(task.status)}: ${displayContent}, ${conversationLabel}, ${updatedLabel}`}
      className="h-auto w-full items-start gap-3 rounded-none border-b border-border/60 px-0 py-3 text-left hover:bg-muted/40"
    >
      <TaskStatusMark status={task.status} />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block break-words text-sm leading-snug',
            task.status === 'completed' ? 'text-muted-foreground line-through' : 'text-foreground'
          )}
        >
          {displayContent}
        </span>
        <span className="text-muted-foreground mt-1 block truncate text-xs" title={conversationLabel}>
          {conversationLabel}
        </span>
      </span>
      <time
        dateTime={dateTime}
        className="text-muted-foreground shrink-0 pt-0.5 text-[11px]"
      >
        {updatedLabel}
      </time>
    </Button>
  );
}

const TaskGroupSection = ({
  id,
  title,
  tasks,
  earlierTasks = [],
  conversationSubjects,
  projectNames,
  onOpenConversation,
}: TaskGroupSectionProps): JSX.Element | null => {
  const [showEarlier, setShowEarlier] = useState(false);
  const visibleTasks = showEarlier ? [...tasks, ...earlierTasks] : tasks;
  if (tasks.length === 0 && earlierTasks.length === 0) return null;

  return (
    <section aria-labelledby={`${id}-heading`} className="border-border/60 border-b pb-5 last:border-b-0">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 id={`${id}-heading`} className="text-foreground text-sm font-semibold">
          {title}
        </h2>
        <span className="text-muted-foreground text-[11px]">
          {visibleTasks.length} {visibleTasks.length === 1 ? 'task' : 'tasks'}
        </span>
      </div>

      {tasks.length > 0 && (
        <div role="list" aria-label={`${title} tasks`}>
          {tasks.map((task) => (
            <div key={task.key} role="listitem">
              <TaskRow
                task={task}
                conversationSubjects={conversationSubjects}
                projectNames={projectNames}
                onOpenConversation={onOpenConversation}
              />
            </div>
          ))}
        </div>
      )}

      {earlierTasks.length > 0 && (
        <>
          <Button
            type="button"
            variant="link"
            aria-expanded={showEarlier}
            aria-controls={`${id}-earlier-tasks`}
            onClick={() => setShowEarlier((visible) => !visible)}
            className="mt-3 h-auto px-0 py-1 text-xs"
          >
            {showEarlier ? 'Hide earlier' : 'Show earlier'} ({earlierTasks.length})
          </Button>
          {showEarlier && (
            <div
              id={`${id}-earlier-tasks`}
              role="group"
              aria-label="Earlier completed tasks"
              className="mt-3 border-t border-border/60 pt-2"
            >
              <p className="text-muted-foreground mb-1 text-[11px]">Earlier completed tasks</p>
              <div role="list" aria-label="Earlier completed tasks">
                {earlierTasks.map((task) => (
                  <div key={task.key} role="listitem">
                    <TaskRow
                      task={task}
                      conversationSubjects={conversationSubjects}
                      projectNames={projectNames}
                      onOpenConversation={onOpenConversation}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
};

export const TaskList = ({
  todos,
  loading,
  error,
  projectNames,
  onOpenConversation,
}: Readonly<TaskListProps>): JSX.Element => {
  const conversationIdentities = useMemo(
    () => todos.map(({ projectId, sessionId }) => ({ projectId, sessionId })),
    [todos]
  );
  const conversationSubjects = useConversationSubjects(conversationIdentities);
  const groups = useMemo(() => flattenSimpleTasks(todos), [todos]);
  const hasTasks =
    groups.happeningNow.length > 0 ||
    groups.waiting.length > 0 ||
    groups.recentlyDone.length > 0 ||
    groups.earlierCompleted.length > 0;
  const hasVisibleTasks =
    groups.happeningNow.length > 0 ||
    groups.waiting.length > 0 ||
    groups.recentlyDone.length > 0;

  return (
    <section
      aria-labelledby="tasks-heading"
      className="bg-background flex h-full flex-1 flex-col overflow-y-auto"
    >
      <header className="border-border/60 shrink-0 border-b px-6 py-5">
        <h1 id="tasks-heading" className="text-foreground text-lg font-semibold tracking-tight">
          Tasks
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          What Claude is working on across your conversations.
        </p>
      </header>

      {error && hasTasks && (
        <div role="alert" className="border-destructive/30 bg-destructive/10 border-b px-6 py-3 text-sm">
          <span className="text-destructive">Could not refresh tasks. {sanitizeSimpleText(error)}</span>
        </div>
      )}

      {loading && !hasTasks ? (
        <div role="status" className="text-muted-foreground flex flex-1 items-center justify-center px-6 text-sm">
          Loading tasks
        </div>
      ) : error && !hasTasks ? (
        <div role="alert" className="flex flex-1 items-center justify-center px-6 text-center">
          <div className="max-w-sm">
            <p className="text-foreground text-sm font-medium">Could not load tasks</p>
            <p className="text-muted-foreground mt-1 text-sm">{sanitizeSimpleText(error)}</p>
          </div>
        </div>
      ) : !hasTasks ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="text-muted-foreground text-sm">No tasks to show right now.</p>
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-6">
          {loading && (
            <div role="status" className="text-muted-foreground text-xs">
              Refreshing tasks
            </div>
          )}
          {!hasVisibleTasks && groups.earlierCompleted.length > 0 && (
            <div role="status" className="text-muted-foreground text-sm">
              No recently updated completed tasks.
            </div>
          )}
          <TaskGroupSection
            id="happening-now"
            title="Happening now"
            tasks={groups.happeningNow}
            conversationSubjects={conversationSubjects}
            projectNames={projectNames}
            onOpenConversation={onOpenConversation}
          />
          <TaskGroupSection
            id="waiting"
            title="Waiting"
            tasks={groups.waiting}
            conversationSubjects={conversationSubjects}
            projectNames={projectNames}
            onOpenConversation={onOpenConversation}
          />
          <TaskGroupSection
            id="recently-done"
            title="Recently done"
            tasks={groups.recentlyDone}
            earlierTasks={groups.earlierCompleted}
            conversationSubjects={conversationSubjects}
            projectNames={projectNames}
            onOpenConversation={onOpenConversation}
          />
        </div>
      )}
    </section>
  );
};
