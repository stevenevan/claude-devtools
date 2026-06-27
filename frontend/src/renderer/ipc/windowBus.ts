

const COALESCE_WINDOW_MS = 50;

export interface BusMessage<T = unknown> {
  originWindowId: string;
  topic: string;
  seq: number;
  payload: T;
}

export interface BusTransport {
  emit(message: BusMessage): void;

  subscribe(listener: (message: BusMessage) => void): () => void;
}

export interface WindowBus {
  emit<T>(topic: string, payload: T): void;
  subscribe<T>(topic: string, listener: (message: BusMessage<T>) => void): () => void;
  windowId(): string;
  pendingTimers(): number;
  flushPending(): void;

  markReady(): void;

  isReady(): boolean;
  dispose(): void;
}

interface PendingEmit {
  payload: unknown;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface WindowBusOptions {

  requireHandshake?: boolean;
}

export function createWindowBus(
  transport: BusTransport,
  windowId: string,
  options: WindowBusOptions = {}
): WindowBus {
  const seqByTopic = new Map<string, number>();
  const pendingByTopic = new Map<string, PendingEmit>();
  const lastDeliveredSeq = new Map<string, number>();
  const subscribers = new Map<string, Set<(message: BusMessage) => void>>();
  const seedBuffer: BusMessage[] = [];
  let ready = !options.requireHandshake;

  const deliver = (message: BusMessage): void => {
    const subs = subscribers.get(message.topic);
    if (!subs) return;
    for (const sub of subs) {
      try {
        sub(message);
      } catch {
        // Listener errors must not break the bus.
      }
    }
  };

  const dispatch = (message: BusMessage): void => {
    if (message.originWindowId === windowId) return; // self-origin filter
    const last = lastDeliveredSeq.get(message.topic) ?? -1;
    if (message.seq <= last) return; // out-of-order or duplicate
    lastDeliveredSeq.set(message.topic, message.seq);
    if (!ready) {
      seedBuffer.push(message);
      return;
    }
    deliver(message);
  };

  const unsubscribeTransport = transport.subscribe(dispatch);

  function flushTopic(topic: string): void {
    const pending = pendingByTopic.get(topic);
    if (!pending) return;
    pendingByTopic.delete(topic);
    if (pending.timer !== null) clearTimeout(pending.timer);
    const seq = (seqByTopic.get(topic) ?? 0) + 1;
    seqByTopic.set(topic, seq);
    transport.emit({
      originWindowId: windowId,
      topic,
      seq,
      payload: pending.payload,
    });
  }

  return {
    emit<T>(topic: string, payload: T): void {
      const existing = pendingByTopic.get(topic);
      if (existing && existing.timer !== null) {
        // Last-write-wins inside the coalesce window.
        existing.payload = payload;
        return;
      }
      const pending: PendingEmit = { payload, timer: null };
      pendingByTopic.set(topic, pending);
      pending.timer = setTimeout(() => flushTopic(topic), COALESCE_WINDOW_MS);
    },
    subscribe<T>(topic: string, listener: (message: BusMessage<T>) => void): () => void {
      const set = subscribers.get(topic) ?? new Set();
      const wrapper = (msg: BusMessage): void => listener(msg as BusMessage<T>);
      set.add(wrapper);
      subscribers.set(topic, set);
      return () => {
        set.delete(wrapper);
        if (set.size === 0) subscribers.delete(topic);
      };
    },
    windowId: () => windowId,
    pendingTimers: () => pendingByTopic.size,
    flushPending: () => {
      const topics = Array.from(pendingByTopic.keys());
      for (const topic of topics) flushTopic(topic);
    },
    markReady: () => {
      if (ready) return;
      ready = true;
      const drained = seedBuffer.splice(0, seedBuffer.length);
      for (const msg of drained) deliver(msg);
    },
    isReady: () => ready,
    dispose: () => {
      for (const [, pending] of pendingByTopic) {
        if (pending.timer !== null) clearTimeout(pending.timer);
      }
      pendingByTopic.clear();
      subscribers.clear();
      unsubscribeTransport();
    },
  };
}

export function createMemoryTransport(): {
  transport: BusTransport;

  emit: (message: BusMessage) => void;
} {
  const listeners = new Set<(message: BusMessage) => void>();
  const transport: BusTransport = {
    emit(message) {
      for (const listener of listeners) listener(message);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    transport,
    emit: (message: BusMessage) => transport.emit(message),
  };
}
