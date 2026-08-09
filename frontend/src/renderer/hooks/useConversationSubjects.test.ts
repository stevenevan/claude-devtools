import { expect, test } from 'bun:test';

import {
  conversationSubjectKey,
  resolveConversationSubjects,
} from './useConversationSubjects';

import type { Session } from '@shared/types';

function session(overrides: Partial<Session>): Session {
  return {
    id: 'session-1',
    projectId: 'project-1',
    projectPath: '/workspace/example',
    createdAt: 100,
    hasSubagents: false,
    messageCount: 1,
    ...overrides,
  };
}

test('batches unique identities by project and resolves subjects from full sessions', async () => {
  const calls: Array<{ projectId: string; sessionIds: string[] }> = [];
  const subjects = await resolveConversationSubjects(
    [
      { projectId: 'project-a', sessionId: 'same-id' },
      { projectId: 'project-b', sessionId: 'same-id' },
      { projectId: 'project-a', sessionId: 'same-id' },
      { projectId: 'project-a', sessionId: 'other-id' },
    ],
    async (projectId, sessionIds) => {
      calls.push({ projectId, sessionIds });
      if (projectId === 'project-a') {
        return [
          session({
            id: 'same-id',
            projectId,
            customTitle: 'Resolved subject',
          }),
          session({
            id: 'other-id',
            projectId,
            firstMessage: 'Resolved first message',
          }),
        ];
      }
      throw new Error('lookup failed');
    }
  );

  expect(calls).toEqual([
    { projectId: 'project-a', sessionIds: ['same-id', 'other-id'] },
    { projectId: 'project-b', sessionIds: ['same-id'] },
  ]);
  expect(subjects.get(conversationSubjectKey({ projectId: 'project-a', sessionId: 'same-id' }))).toBe(
    'Resolved subject'
  );
  expect(
    subjects.get(conversationSubjectKey({ projectId: 'project-a', sessionId: 'other-id' }))
  ).toBe('Resolved first message');
  expect(subjects.get(conversationSubjectKey({ projectId: 'project-b', sessionId: 'same-id' }))).toBe(
    'Untitled conversation'
  );
});
