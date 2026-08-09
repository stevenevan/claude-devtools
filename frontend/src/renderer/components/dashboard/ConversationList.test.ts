import { expect, test } from 'bun:test';

import {
  appendConversationEndSentinel,
  buildConversationListItems,
  disambiguateConversationGroups,
  flattenConversationGroups,
  groupConversations,
  sortConversationGroups,
} from './conversationListHelpers';
import {
  formatApproximateConversationCost,
  formatConversationMessageCount,
  formatConversationSubject,
} from './dashboardFormatters';

import type { GlobalSession } from '@shared/types';

function session(overrides: Partial<GlobalSession>): GlobalSession {
  return {
    id: 'session-1',
    projectId: 'project-1',
    projectPath: '/workspace/example',
    projectName: 'example',
    createdAt: 100,
    messageCount: 1,
    ...overrides,
  };
}

test('groups by project, sorts conversations newest-first, and sorts groups by recent activity', () => {
  const groups = sortConversationGroups(
    groupConversations([
      session({ id: 'older', createdAt: 10, projectId: 'alpha', projectName: 'alpha' }),
      session({ id: 'newest', createdAt: 30, projectId: 'beta', projectName: 'beta' }),
      session({ id: 'newer', createdAt: 20, projectId: 'alpha', projectName: 'alpha' }),
    ])
  );

  expect(groups.map((group) => group.id)).toEqual(['beta', 'alpha']);
  expect(groups[1]?.sessions.map((item) => item.id)).toEqual(['newer', 'older']);
});

test('uses a non-absolute folder name and disambiguates duplicate names by parent segment', () => {
  const groups = disambiguateConversationGroups(
    sortConversationGroups(
      groupConversations([
        session({
          projectId: 'client-app',
          projectPath: '/workspace/apps/client',
          projectName: '/workspace/apps/client',
        }),
        session({
          id: 'session-2',
          projectId: 'client-package',
          projectPath: '/workspace/packages/client',
          projectName: 'client',
        }),
      ])
    )
  );

  expect(groups.map((group) => group.label).sort()).toEqual([
    'client · apps',
    'client · packages',
  ]);
  expect(groups.every((group) => !group.label.startsWith('/'))).toBe(true);
});

test('flattens headings and conversations with project-qualified stable keys', () => {
  const groups = disambiguateConversationGroups(
    sortConversationGroups(
      groupConversations([
        session({ id: 'same-id', projectId: 'alpha', projectName: 'alpha', createdAt: 20 }),
        session({ id: 'same-id', projectId: 'beta', projectName: 'beta', createdAt: 10 }),
      ])
    )
  );

  const items = flattenConversationGroups(groups);

  expect(items.map((item) => item.id)).toEqual([
    'group:alpha',
    'conversation:alpha\0same-id',
    'group:beta',
    'conversation:beta\0same-id',
  ]);
});

test('adds an end sentinel only while the global feed has another page', () => {
  const items = buildConversationListItems([session({})]);

  const itemsWithSentinel = appendConversationEndSentinel(items, true);
  expect(itemsWithSentinel[itemsWithSentinel.length - 1]).toEqual({
    type: 'end-sentinel',
    id: 'conversation-feed-end',
  });
  expect(appendConversationEndSentinel(items, false)).toEqual(items);
});

test('formats conversation metadata for list and reader reuse', () => {
  expect(formatConversationSubject(session({ customTitle: 'Custom title' }))).toBe('Custom title');
  expect(formatConversationMessageCount(1)).toBe('1 message');
  expect(formatConversationMessageCount(2)).toBe('2 messages');
  expect(formatApproximateConversationCost(0.4)).toBe('about $0.400');
  expect(formatApproximateConversationCost()).toBe('Cost unavailable');
});
