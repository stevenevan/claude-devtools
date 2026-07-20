import { expect, mock, test } from 'bun:test';

const invocations: Array<{ command: string; args?: Record<string, unknown> }> = [];
let shouldReject = false;

mock.module('@tauri-apps/api/core', () => ({
  invoke: async (command: string, args?: Record<string, unknown>) => {
    invocations.push({ command, args });
    if (shouldReject) throw new Error('unavailable');
  },
}));

const { logger } = await import('./logger');

test('logger invokes the validated renderer telemetry command', async () => {
  logger.info('started', { requestId: 'r-1' });
  await Promise.resolve();

  expect(invocations.pop()).toEqual({
    command: 'log_renderer_event',
    args: { level: 'info', message: 'started', context: { requestId: 'r-1' } },
  });
});

test('logger swallows telemetry failures', async () => {
  shouldReject = true;
  logger.warn('unavailable');
  await Promise.resolve();
  shouldReject = false;
  expect(invocations.pop()?.command).toBe('log_renderer_event');
});
