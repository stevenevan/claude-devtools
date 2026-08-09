import { beforeEach, expect, test } from 'bun:test';

import { useStore } from './index';

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  useStore.setState({ fetchSessionDetail: async () => undefined });
});

test('opens and focuses duplicate session IDs by exact project identity', () => {
  useStore.getState().navigateToSession('project-a', 'same-session');
  const tabA = useStore.getState().getActiveTab();

  useStore.getState().navigateToSession('project-b', 'same-session');
  const tabB = useStore.getState().getActiveTab();

  expect(tabA?.projectId).toBe('project-a');
  expect(tabB?.projectId).toBe('project-b');
  expect(tabB?.id).not.toBe(tabA?.id);
  expect(useStore.getState().openTabs.filter((tab) => tab.type === 'session')).toHaveLength(2);
  expect(useStore.getState().selectedProjectId).toBe('project-b');
  expect(useStore.getState().selectedSessionId).toBe('same-session');

  useStore.getState().navigateToSession('project-b', 'same-session');

  expect(useStore.getState().getActiveTab()?.id).toBe(tabB?.id);
  expect(useStore.getState().openTabs.filter((tab) => tab.type === 'session')).toHaveLength(2);
});
