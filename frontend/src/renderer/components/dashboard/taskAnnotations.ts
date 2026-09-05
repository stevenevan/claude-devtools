import type { AnnotationEntry } from '@shared/types';

export interface TaskIdentity {
  projectId: string;
  sessionId: string;
  content: string;
}

const TASK_TARGET_PREFIX = 'task:';

export function taskAnnotationTargetId(task: TaskIdentity): string {
  return `${TASK_TARGET_PREFIX}${task.projectId}:${task.sessionId}:${task.content}`;
}

export interface ParsedTaskTarget extends TaskIdentity {}

export function parseTaskAnnotationTarget(targetId: string): ParsedTaskTarget | null {
  if (!targetId.startsWith(TASK_TARGET_PREFIX)) return null;
  const rest = targetId.slice(TASK_TARGET_PREFIX.length);
  const firstSeparator = rest.indexOf(':');
  if (firstSeparator === -1) return null;
  const secondSeparator = rest.indexOf(':', firstSeparator + 1);
  if (secondSeparator === -1) return null;
  const projectId = rest.slice(0, firstSeparator);
  const sessionId = rest.slice(firstSeparator + 1, secondSeparator);
  const content = rest.slice(secondSeparator + 1);
  if (!projectId || !sessionId) return null;
  return { projectId, sessionId, content };
}

export function isTaskAnnotationTarget(targetId: string): boolean {
  return targetId.startsWith(TASK_TARGET_PREFIX);
}

export function annotationsForTask(
  annotations: readonly AnnotationEntry[],
  task: TaskIdentity
): AnnotationEntry[] {
  const target = taskAnnotationTargetId(task);
  return annotations.filter((annotation) => annotation.targetId === target);
}

export function taskTargetLabel(targetId: string, mode: 'simple' | 'nerd'): string | null {
  const parsed = parseTaskAnnotationTarget(targetId);
  if (!parsed) return null;
  if (mode === 'simple') return 'Task note';
  const preview = parsed.content.length > 40 ? `${parsed.content.slice(0, 40)}…` : parsed.content;
  return `Task: ${preview || 'untitled'}`;
}
