/**
 * Type definitions for Claude Code task/todo data.
 * Parsed from ~/.claude/todos/{sessionId}.json files.
 */

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

export function parseTodoData(data: unknown): TodoItem[] {
  if (!Array.isArray(data)) return [];
  return data.filter(
    (item): item is TodoItem =>
      typeof item === 'object' &&
      item !== null &&
      typeof item.content === 'string' &&
      typeof item.status === 'string' &&
      ['pending', 'in_progress', 'completed'].includes(item.status)
  );
}

export function countPendingTodos(data: unknown): number {
  const items = parseTodoData(data);
  return items.filter((item) => item.status !== 'completed').length;
}
