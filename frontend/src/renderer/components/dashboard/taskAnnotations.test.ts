import { describe, expect, test } from 'bun:test';

import {
  annotationsForTask,
  isTaskAnnotationTarget,
  parseTaskAnnotationTarget,
  taskAnnotationTargetId,
  taskTargetLabel,
} from './taskAnnotations';

import type { AnnotationEntry } from '@shared/types';

function annotation(id: string, targetId: string): AnnotationEntry {
  return {
    id,
    sessionId: 'session-a',
    projectId: 'project-a',
    targetId,
    text: `note ${id}`,
    color: 'amber',
    createdAt: 1,
    updatedAt: 2,
  };
}

const task = { projectId: 'project-a', sessionId: 'session-a', content: 'Write the test' };

describe('task annotation links', () => {
  test('attaches annotations to a task through a stable target id', () => {
    const target = taskAnnotationTargetId(task);
    const linked = [annotation('note-1', target), annotation('note-2', 'other-target')];

    expect(isTaskAnnotationTarget(target)).toBeTrue();
    expect(isTaskAnnotationTarget('other-target')).toBeFalse();
    expect(annotationsForTask(linked, task).map((entry) => entry.id)).toEqual(['note-1']);
  });

  test('round-trips content containing separators', () => {
    const tricky = { ...task, content: 'Fix a:b and c:d now' };
    const parsed = parseTaskAnnotationTarget(taskAnnotationTargetId(tricky));

    expect(parsed).toEqual(tricky);
    expect(parseTaskAnnotationTarget('task:only-project')).toBeNull();
    expect(parseTaskAnnotationTarget('message-target')).toBeNull();
  });

  test('detaches a note with undo and lets orphans survive task removal', () => {
    const target = taskAnnotationTargetId(task);
    const stored = [annotation('note-1', target), annotation('note-2', 'other-target')];

    const detached = stored.filter((entry) => entry.id !== 'note-1');
    expect(annotationsForTask(detached, task)).toEqual([]);

    const undone = [...detached, stored[0]].filter(Boolean);
    expect(annotationsForTask(undone, task).map((entry) => entry.id)).toEqual(['note-1']);

    const tasksAfterDelete: { projectId: string; sessionId: string; content: string }[] = [];
    expect(tasksAfterDelete).toEqual([]);
    expect(stored.map((entry) => entry.id)).toEqual(['note-1', 'note-2']);
  });

  test('labels task notes per mode', () => {
    const target = taskAnnotationTargetId(task);
    expect(taskTargetLabel(target, 'simple')).toBe('Task note');
    expect(taskTargetLabel(target, 'nerd')).toBe('Task: Write the test');
    expect(taskTargetLabel('other-target', 'nerd')).toBeNull();
  });
});
