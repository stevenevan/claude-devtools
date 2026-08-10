import { afterEach, beforeEach, expect, test } from 'bun:test';

import { api } from '@renderer/api';
import { useStore } from '@renderer/store';

import type { AnnotationEntry } from '@shared/types';

const originalRemoveAnnotation = api.config.removeAnnotation;

function annotation(): AnnotationEntry {
  return {
    id: 'annotation-1',
    sessionId: 'session-1',
    projectId: 'project-1',
    targetId: 'turn-1',
    text: 'Remember this',
    color: 'blue',
    createdAt: 1,
    updatedAt: 1,
  };
}

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  useStore.setState({ annotations: [annotation()], annotationsError: null });
});

afterEach(() => {
  api.config.removeAnnotation = originalRemoveAnnotation;
});

test('removes an annotation only after the API succeeds', async () => {
  let calls = 0;
  api.config.removeAnnotation = async () => {
    calls++;
  };

  await useStore.getState().removeAnnotation('annotation-1');

  expect(calls).toBe(1);
  expect(useStore.getState().annotations).toEqual([]);
  expect(useStore.getState().annotationsError).toBeNull();
});

test('retains an annotation and exposes an API failure', async () => {
  api.config.removeAnnotation = async () => {
    throw new Error('config save failed');
  };

  await useStore.getState().removeAnnotation('annotation-1');

  expect(useStore.getState().annotations).toEqual([annotation()]);
  expect(useStore.getState().annotationsError).toBe('config save failed');
});
