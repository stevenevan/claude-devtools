import { useEffect, useMemo, useState } from 'react';

import { api } from '@renderer/api';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { parseTodoData } from '@renderer/types/todos';
import { createLogger } from '@shared/utils/logger';
import { formatDistanceToNowStrict } from 'date-fns';
import { CheckCircle2, Circle, ListTodo, Loader2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { AggregatedSessionTodos } from '@shared/types';

const logger = createLogger('Component:TodosDashboard');

type StatusFilter = 'all' | 'pending' | 'in_progress' | 'completed';

interface ProjectGroup {
  projectId: string;
  projectName: string;
  sessions: AggregatedSessionTodos[];
  totalItems: number;
  completedItems: number;
}

export const TodosDashboard = (): React.JSX.Element => {
  const { projects, repositoryGroups, navigateToSession } = useStore(
    useShallow((s) => ({
      projects: s.projects,
      repositoryGroups: s.repositoryGroups,
      navigateToSession: s.navigateToSession,
    }))
  );

  const [todos, setTodos] = useState<AggregatedSessionTodos[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const projectIds = useMemo(() => projects.map((p) => p.id), [projects]);

  useEffect(() => {
    if (projectIds.length === 0) {
      setTodos([]);
      return;
    }
    let cancelled = false;
    const run = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.getAllTodos(projectIds);
        if (!cancelled) setTodos(result);
      } catch (err) {
        if (!cancelled) {
          logger.error('Failed to fetch todos:', err);
          setError(err instanceof Error ? err.message : 'Failed to load todos');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [projectIds]);

  const projectNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of repositoryGroups) {
      for (const worktree of group.worktrees) {
        map.set(worktree.id, group.name);
      }
    }
    return map;
  }, [repositoryGroups]);

  const grouped: ProjectGroup[] = useMemo(() => {
    const groups = new Map<string, ProjectGroup>();
    for (const session of todos) {
      const items = parseTodoData(session.items).filter(
        (item) => statusFilter === 'all' || item.status === statusFilter
      );
      if (items.length === 0) continue;
      const filteredSession: AggregatedSessionTodos = {
        ...session,
        items,
      };
      const bucket = groups.get(session.projectId) ?? {
        projectId: session.projectId,
        projectName: projectNameById.get(session.projectId) ?? session.projectId,
        sessions: [],
        totalItems: 0,
        completedItems: 0,
      };
      bucket.sessions.push(filteredSession);
      const allItems = parseTodoData(session.items);
      bucket.totalItems += allItems.length;
      bucket.completedItems += allItems.filter((i) => i.status === 'completed').length;
      groups.set(session.projectId, bucket);
    }
    return Array.from(groups.values()).sort((a, b) => b.sessions.length - a.sessions.length);
  }, [todos, projectNameById, statusFilter]);

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <div className="mb-4">
        <h1 className="text-foreground text-lg font-medium">Todos</h1>
        <p className="text-muted-foreground text-sm">
          Live task status across every tracked project
        </p>
      </div>

      <div className="mb-4 flex items-center gap-2">
        {(['all', 'pending', 'in_progress', 'completed'] as StatusFilter[]).map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => setStatusFilter(filter)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              statusFilter === filter
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-background text-muted-foreground hover:bg-surface-raised'
            )}
          >
            {filter === 'in_progress'
              ? 'In progress'
              : filter.charAt(0).toUpperCase() + filter.slice(1)}
          </button>
        ))}
        {loading && <Loader2 className="text-muted-foreground ml-2 size-4 animate-spin" />}
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {!loading && grouped.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center">
          <ListTodo className="text-muted-foreground mb-2 size-6" />
          <p className="text-muted-foreground text-xs">No todos match this filter.</p>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {grouped.map((group) => (
          <ProjectSection
            key={group.projectId}
            group={group}
            onOpenSession={(sessionId) => navigateToSession(group.projectId, sessionId)}
          />
        ))}
      </div>
    </div>
  );
};

const ProjectSection = ({
  group,
  onOpenSession,
}: Readonly<{
  group: ProjectGroup;
  onOpenSession: (sessionId: string) => void;
}>): React.JSX.Element => {
  const progress = group.totalItems === 0 ? 0 : group.completedItems / group.totalItems;
  return (
    <div className="border-border bg-background/50 rounded-md border p-4">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-foreground text-sm font-semibold">{group.projectName}</h3>
          <p className="text-muted-foreground text-[11px]">
            {group.completedItems}/{group.totalItems} completed · {group.sessions.length} session
            {group.sessions.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="bg-surface-raised h-1.5 w-40 overflow-hidden rounded-full">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {group.sessions.map((session) => (
          <SessionTodoCard
            key={session.sessionId}
            session={session}
            onOpen={() => onOpenSession(session.sessionId)}
          />
        ))}
      </div>
    </div>
  );
};

const SessionTodoCard = ({
  session,
  onOpen,
}: Readonly<{
  session: AggregatedSessionTodos;
  onOpen: () => void;
}>): React.JSX.Element => {
  const items = parseTodoData(session.items);
  const updated = formatDistanceToNowStrict(new Date(session.updatedAt), { addSuffix: true });

  return (
    <button
      type="button"
      onClick={onOpen}
      className="border-border/60 bg-card hover:border-border-emphasis rounded-md border p-3 text-left transition-colors"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-muted-foreground font-mono text-[11px]">
          {session.sessionId.slice(0, 12)}
        </span>
        <span className="text-muted-foreground text-[10px]">{updated}</span>
      </div>
      <ul className="flex flex-col gap-1">
        {items.map((item, idx) => (
          <li key={idx} className="flex items-start gap-2 text-xs">
            {item.status === 'completed' ? (
              <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-400" />
            ) : item.status === 'in_progress' ? (
              <Loader2 className="mt-0.5 size-3 shrink-0 animate-spin text-blue-400" />
            ) : (
              <Circle className="text-muted-foreground mt-0.5 size-3 shrink-0" />
            )}
            <span
              className={cn(
                'flex-1 break-words',
                item.status === 'completed' ? 'text-muted-foreground line-through' : 'text-foreground'
              )}
            >
              {item.content}
            </span>
          </li>
        ))}
      </ul>
    </button>
  );
};
