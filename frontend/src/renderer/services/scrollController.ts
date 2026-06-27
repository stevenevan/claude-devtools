

export type ScrollWriter =
  | 'user-scroll'
  | 'minimap'
  | 'navigation'
  | 'virtualizer'
  | 'replay-cursor'
  | 'scrubber'
  | (string & {});

const DEFAULT_HOLD_MS = 200;

interface Lock {
  writer: ScrollWriter;
  expiresAt: number;
}

const listeners = new Set<(writer: ScrollWriter | null) => void>();
let lock: Lock | null = null;
let expireTimer: ReturnType<typeof setTimeout> | null = null;

function now(): number {
  return Date.now();
}

function notify(): void {
  const writer = lock?.writer ?? null;
  for (const l of listeners) l(writer);
}

function clearExpireTimer(): void {
  if (expireTimer) {
    clearTimeout(expireTimer);
    expireTimer = null;
  }
}

function scheduleExpire(): void {
  clearExpireTimer();
  if (!lock) return;
  const remaining = Math.max(0, lock.expiresAt - now());
  expireTimer = setTimeout(() => {
    if (lock && lock.expiresAt <= now()) {
      lock = null;
      notify();
    }
  }, remaining);
}

export const scrollController = {
  acquire(writer: ScrollWriter, durationMs: number = DEFAULT_HOLD_MS): void {
    lock = { writer, expiresAt: now() + durationMs };
    scheduleExpire();
    notify();
  },

  release(writer: ScrollWriter): void {
    if (lock?.writer === writer) {
      lock = null;
      clearExpireTimer();
      notify();
    }
  },

  owner(): ScrollWriter | null {
    if (lock && lock.expiresAt <= now()) {
      lock = null;
      clearExpireTimer();
    }
    return lock?.writer ?? null;
  },

  isOwnedBy(writer: ScrollWriter): boolean {
    return scrollController.owner() === writer;
  },

  isBusyFor(observer: ScrollWriter): boolean {
    const current = scrollController.owner();
    return current !== null && current !== observer;
  },

  subscribe(fn: (writer: ScrollWriter | null) => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },

  _resetForTests(): void {
    lock = null;
    clearExpireTimer();
    listeners.clear();
  },
};
