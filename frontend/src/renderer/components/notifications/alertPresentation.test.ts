import { expect, test } from 'bun:test';

import {
  getAlertConversationLabel,
  getAlertTarget,
  getSimpleAlertEmptyState,
  orderAlerts,
  presentSimpleAlert,
} from './alertPresentation';
import { conversationSubjectKey } from '@renderer/hooks/useConversationSubjects';

import type { DetectedError } from '@renderer/types/data';

const NOW = new Date(2026, 7, 10, 12, 0, 0).getTime();

function alert(overrides: Partial<DetectedError> = {}): DetectedError {
  return {
    id: 'alert-1',
    timestamp: NOW,
    sessionId: 'session-1',
    projectId: 'project-1',
    filePath: '/Users/alice/project/session.jsonl',
    source: 'error-detector',
    message: 'Something failed',
    isRead: false,
    createdAt: NOW,
    context: { projectName: 'client-app' },
    ...overrides,
  };
}

test('sanitizes opaque Simple source, message, and subject text', () => {
  const notification = alert({
    source: 'claude-opus-4-1',
    message:
      'Open /Users/alice/private/notes.txt for 123e4567-e89b-12d3-a456-426614174000 with 12,345 input tokens from trace.jsonl',
    context: { projectName: '/Users/alice/client-app' },
  });
  const subjects = new Map([
    [conversationSubjectKey({ projectId: 'project-1', sessionId: 'session-1' }), 'claude-sonnet-4-5'],
  ]);

  const presentation = presentSimpleAlert(notification, subjects, NOW);

  expect(presentation.source).toBe('Claude');
  expect(presentation.relativeTime).toContain('ago');
  expect(presentation.message).toContain('notes.txt');
  expect(presentation.message).toContain('a session identifier');
  expect(presentation.message).toContain('usage details');
  expect(presentation.message).toContain('session file');
  expect(presentation.message).not.toContain('/Users/alice');
  expect(presentation.message).not.toContain('123e4567-e89b-12d3-a456-426614174000');
  expect(presentation.message).not.toContain('12,345 input tokens');
  expect(presentation.message).not.toContain('trace.jsonl');
  expect(presentation.conversationSubject).toBe('Claude');
});

test('uses the project-qualified conversation subject and target only with both IDs', () => {
  const notification = alert();
  const subjects = new Map([
    [conversationSubjectKey({ projectId: 'project-1', sessionId: 'session-1' }), 'Build dashboard'],
  ]);

  expect(getAlertTarget(notification)).toEqual({ projectId: 'project-1', sessionId: 'session-1' });
  expect(getAlertConversationLabel(notification, subjects)).toBe('Build dashboard');
  expect(getAlertTarget({ projectId: 'project-1', sessionId: ' ' })).toBeNull();
  expect(getAlertTarget({ projectId: '', sessionId: 'session-1' })).toBeNull();
});

test('keeps synthetic alerts readable without an action target', () => {
  const presentation = presentSimpleAlert(
    alert({
      projectId: '',
      sessionId: '',
      source: 'config-drift',
      message: 'Configuration changed in /Users/alice/project/settings.json',
    }),
    new Map(),
    NOW
  );

  expect(presentation.target).toBeNull();
  expect(presentation.source).toBe('Config drift');
  expect(presentation.message).toContain('settings.json');
  expect(presentation.message).not.toContain('/Users/alice');
  expect(presentation.conversationSubject).toBe('client-app');
});

test('orders alerts in reverse chronological order without mutating the source array', () => {
  const source = [
    alert({ id: 'older', timestamp: NOW - 10_000 }),
    alert({ id: 'newer', timestamp: NOW + 10_000 }),
    alert({ id: 'same-time-a', timestamp: NOW }),
    alert({ id: 'same-time-b', timestamp: NOW }),
  ];

  const ordered = orderAlerts(source);

  expect(ordered.map((item) => item.id)).toEqual(['newer', 'same-time-a', 'same-time-b', 'older']);
  expect(source.map((item) => item.id)).toEqual(['older', 'newer', 'same-time-a', 'same-time-b']);
});

test('distinguishes no records from no enabled triggers', () => {
  expect(getSimpleAlertEmptyState([], false)).toBe('no-enabled-triggers');
  expect(getSimpleAlertEmptyState([], true)).toBe('no-records');
  expect(getSimpleAlertEmptyState([alert()], false)).toBeNull();
});

test('keeps Simple controls limited to read state, settings, and valid conversation targets', async () => {
  const source = await Bun.file(new URL('./AlertList.tsx', import.meta.url)).text();

  expect(source).toContain('Mark all read');
  expect(source).toContain('Open notification settings');
  expect(source).toContain('presentation.target &&');
  expect(source).not.toContain('<button');
  expect(source.toLowerCase()).not.toContain('delete notification');
  expect(source.toLowerCase()).not.toContain('clear all');
  expect(source).not.toContain('activeFilter');
});
