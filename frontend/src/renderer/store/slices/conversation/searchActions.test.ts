import { beforeEach, expect, test } from 'bun:test';

import { useStore } from '../../index';
import { currentSearchId } from './searchInternals';

import type { SimpleConversation } from '@renderer/types/simpleChat';

const simpleConversation: SimpleConversation = {
  mode: 'simple',
  sessionId: 'session-1',
  items: [
    {
      type: 'user',
      id: 'simple-user-user-1',
      group: { id: 'user-1' },
      content: 'Find this message.',
    },
  ],
};

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
});

test('invalidates prior async search generations for Simple and clear branches', () => {
  const beforeSimpleSearch = currentSearchId();

  useStore.getState().setSearchQuery('message', simpleConversation);
  const afterSimpleSearch = currentSearchId();

  useStore.getState().setSearchQuery('', simpleConversation);

  expect(afterSimpleSearch).toBeGreaterThan(beforeSimpleSearch);
  expect(currentSearchId()).toBeGreaterThan(afterSimpleSearch);
});
