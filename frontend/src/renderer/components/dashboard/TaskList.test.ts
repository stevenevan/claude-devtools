import { expect, test } from 'bun:test';

import {
  conversationSubjectKey,
  type ConversationIdentity,
} from '@renderer/hooks/useConversationSubjects';
import {
  flattenSimpleTasks,
  formatTaskUpdatedAt,
  getTaskConversationLabel,
} from './TaskList';

import type { AggregatedSessionTodos } from '@shared/types';

const NOW = new Date(2026, 7, 10, 12, 0, 0).getTime();

function snapshot(
  projectId: string,
  sessionId: string,
  updatedAt: number,
  items: unknown
): AggregatedSessionTodos {
  return { projectId, sessionId, updatedAt, items };
}

function identity(projectId: string, sessionId: string): ConversationIdentity {
  return { projectId, sessionId };
}

test('flattens snapshots into the three Simple groups and keeps older completions separate', () => {
  const groups = flattenSimpleTasks(
    [
      snapshot('project-a', 'session-a', NOW, [
        { content: 'Implement the fix', status: 'in_progress' },
        { content: 'Review the change', status: 'pending' },
        { content: 'Write the test', status: 'completed' },
      ]),
      snapshot('project-b', 'session-b', new Date(2026, 7, 9, 23, 59).getTime(), [
        { content: 'Archive the old branch', status: 'completed' },
      ]),
    ],
    NOW
  );

  expect(groups.happeningNow.map((task) => task.content)).toEqual(['Implement the fix']);
  expect(groups.waiting.map((task) => task.content)).toEqual(['Review the change']);
  expect(groups.recentlyDone.map((task) => task.content)).toEqual(['Write the test']);
  expect(groups.earlierCompleted.map((task) => task.content)).toEqual(['Archive the old branch']);
});

test('uses snapshot time only as an updated label', () => {
  expect(formatTaskUpdatedAt(NOW - 4 * 60 * 1000, NOW)).toBe('updated 4 minutes ago');
  expect(formatTaskUpdatedAt(Number.NaN, NOW)).toBe('updated time unavailable');
});

test('sanitizes every opaque task string before it reaches Simple rows', () => {
  const groups = flattenSimpleTasks(
    [
      snapshot('project-a', 'session-a', NOW, [
        {
          content:
            'Open /Users/alice/private/notes.txt for 123e4567-e89b-12d3-a456-426614174000 in claude-opus-4-1 with 12,345 input tokens from trace.jsonl',
          status: 'in_progress',
        },
      ]),
    ],
    NOW
  );

  expect(groups.happeningNow[0]?.content).toBe(
    'Open notes.txt for a session identifier in Claude,usage details from session file'
  );
});

test('uses project-qualified subjects and falls back to the folder name', () => {
  const task = flattenSimpleTasks(
    [snapshot('project-a', 'same-session', NOW, [{ content: 'Task', status: 'pending' }])],
    NOW
  ).waiting[0];
  if (!task) throw new Error('Expected a waiting task');

  const subjects = new Map([
    [conversationSubjectKey(identity('project-a', 'same-session')), 'Untitled conversation'],
    [conversationSubjectKey(identity('project-b', 'same-session')), 'Other conversation'],
  ]);
  const projectNames = new Map([
    ['project-a', 'client-app'],
    ['project-b', 'server-app'],
  ]);

  expect(getTaskConversationLabel(task, subjects, projectNames)).toBe('client-app');
  expect(getTaskConversationLabel({ ...task, projectId: 'project-b' }, subjects, projectNames)).toBe(
    'Other conversation'
  );
  expect(getTaskConversationLabel(task, subjects, projectNames)).not.toContain(task.sessionId);
});

test('keeps Simple groups labelled, expandable, and navigated by composite identity', async () => {
  const source = await Bun.file(new URL('./TaskList.tsx', import.meta.url)).text();
  const happeningIndex = source.indexOf('id="happening-now"');
  const waitingIndex = source.indexOf('id="waiting"');
  const recentlyDoneIndex = source.indexOf('id="recently-done"');

  expect(happeningIndex).toBeGreaterThan(-1);
  expect(waitingIndex).toBeGreaterThan(happeningIndex);
  expect(recentlyDoneIndex).toBeGreaterThan(waitingIndex);
  expect(source).toContain('Show earlier');
  expect(source).toContain('earlierTasks.length');
  expect(source).toContain('onOpenConversation(task.projectId, task.sessionId)');
  expect(source).toContain('aria-labelledby');
  expect(source).toContain('aria-expanded');
  expect(source).toContain('No tasks to show right now.');
  expect(source).not.toContain('<button');
  expect(source.toLowerCase()).not.toContain('started ');
});

test('branches TodosDashboard through the shared UI mode hook', async () => {
  const source = await Bun.file(new URL('./TodosDashboard.tsx', import.meta.url)).text();

  expect(source).toContain('useUIMode');
  expect(source).toContain("if (mode === 'simple')");
  expect(source).toContain('<TaskList');
  expect(source).toContain('<NerdTodosDashboard');
});
