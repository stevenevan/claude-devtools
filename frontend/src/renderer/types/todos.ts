/**
 * Type definitions for Claude Code task data.
 * Parsed from ~/.claude/todos/{sessionId}.json files.
 */

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

const VALID_STATUSES = new Set(['pending', 'in_progress', 'completed']);

function isTodoItem(item: unknown): item is TodoItem {
  if (typeof item !== 'object' || item === null) return false;
  const obj = item as Record<string, unknown>;
  return (
    typeof obj.content === 'string' &&
    typeof obj.status === 'string' &&
    VALID_STATUSES.has(obj.status)
  );
}

export function parseTodoData(data: unknown): TodoItem[] {
  if (!Array.isArray(data)) return [];
  return data.filter(isTodoItem);
}

export function countPendingTodos(data: unknown): number {
  const items = parseTodoData(data);
  return items.filter((item) => item.status !== 'completed').length;
}
