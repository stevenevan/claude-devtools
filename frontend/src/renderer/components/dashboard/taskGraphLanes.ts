export type TaskLaneId = 'done' | 'now' | 'next';

export interface TaskLane {
  id: TaskLaneId;
  label: string;
  hint: string;
}

export const TASK_LANES: TaskLane[] = [
  { id: 'done', label: 'Done', hint: 'Finished steps' },
  { id: 'now', label: 'Now', hint: 'Steps running right now' },
  { id: 'next', label: 'Next', hint: 'Steps waiting to run' },
];

// Lane rules use explicit node statuses only: completed is done, in_progress
// is now, and every other status (pending, unknown, future) waits in next.
// Nothing is inferred from message text.
export function laneForStatus(status: string): TaskLaneId {
  if (status === 'completed') return 'done';
  if (status === 'in_progress') return 'now';
  return 'next';
}

export interface TaskLaneGroups<T> {
  done: T[];
  now: T[];
  next: T[];
}

export function groupNodesByLane<T extends { status: string }>(
  nodes: readonly T[]
): TaskLaneGroups<T> {
  const groups: TaskLaneGroups<T> = { done: [], now: [], next: [] };
  for (const node of nodes) {
    groups[laneForStatus(node.status)].push(node);
  }
  return groups;
}
