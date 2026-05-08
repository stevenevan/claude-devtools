import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMemoryTransport,
  createWindowBus,
  type BusMessage,
} from '@renderer/ipc/windowBus';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('windowBus', () => {
  it('filters self-origin emits', () => {
    const transport = createMemoryTransport().transport;
    const bus = createWindowBus(transport, 'win-A');
    const seen: BusMessage[] = [];
    bus.subscribe('selection', (msg) => seen.push(msg));
    bus.emit('selection', { sessionId: 's1' });
    vi.advanceTimersByTime(60);
    expect(seen).toHaveLength(0);
  });

  it('delivers cross-window messages and ignores out-of-order seq', () => {
    const transport = createMemoryTransport();
    const busA = createWindowBus(transport.transport, 'win-A');
    const busB = createWindowBus(transport.transport, 'win-B');
    const received: BusMessage[] = [];
    busB.subscribe('selection', (msg) => received.push(msg));

    busA.emit('selection', { sessionId: 's1' });
    vi.advanceTimersByTime(60);
    busA.emit('selection', { sessionId: 's2' });
    vi.advanceTimersByTime(60);

    expect(received.map((m) => m.seq)).toEqual([1, 2]);

    // Replay the older message — bus must drop it (seq <= last delivered).
    transport.emit({
      originWindowId: 'win-A',
      topic: 'selection',
      seq: 1,
      payload: { sessionId: 'old' },
    });
    expect(received.map((m) => m.seq)).toEqual([1, 2]);
  });

  it('coalesces five rapid emits inside the 50ms window into one', () => {
    const transport = createMemoryTransport();
    const busA = createWindowBus(transport.transport, 'win-A');
    const busB = createWindowBus(transport.transport, 'win-B');
    const received: { sessionId: string }[] = [];
    busB.subscribe<{ sessionId: string }>('selection', (msg) => received.push(msg.payload));

    busA.emit('selection', { sessionId: 's1' });
    busA.emit('selection', { sessionId: 's2' });
    busA.emit('selection', { sessionId: 's3' });
    busA.emit('selection', { sessionId: 's4' });
    busA.emit('selection', { sessionId: 's5' });
    expect(busA.pendingTimers()).toBe(1);

    vi.advanceTimersByTime(60);

    expect(received).toEqual([{ sessionId: 's5' }]);
  });

  it('buffers messages until markReady() is called (handshake gate)', () => {
    const transport = createMemoryTransport();
    const busA = createWindowBus(transport.transport, 'win-A');
    const busB = createWindowBus(transport.transport, 'win-B', { requireHandshake: true });
    const received: BusMessage[] = [];
    busB.subscribe('seed', (msg) => received.push(msg));

    busA.emit('seed', { v: 1 });
    vi.advanceTimersByTime(60);
    expect(received).toHaveLength(0);
    expect(busB.isReady()).toBe(false);

    busB.markReady();
    expect(received).toHaveLength(1);
    expect(received[0].seq).toBe(1);

    busA.emit('seed', { v: 2 });
    vi.advanceTimersByTime(60);
    expect(received).toHaveLength(2);
  });

  it('per-topic Lamport seq increments independently', () => {
    const transport = createMemoryTransport();
    const busA = createWindowBus(transport.transport, 'win-A');
    const busB = createWindowBus(transport.transport, 'win-B');
    const seen: Record<string, number[]> = { selection: [], scroll: [] };
    busB.subscribe('selection', (msg) => seen.selection.push(msg.seq));
    busB.subscribe('scroll', (msg) => seen.scroll.push(msg.seq));

    busA.emit('selection', 1);
    busA.emit('scroll', 2);
    vi.advanceTimersByTime(60);
    busA.emit('selection', 3);
    vi.advanceTimersByTime(60);

    expect(seen.selection).toEqual([1, 2]);
    expect(seen.scroll).toEqual([1]);
  });
});
