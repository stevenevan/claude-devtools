/**
 * ScrollController — central authority for who currently "owns" a chat scroll
 * write. The writer identity is an open string union so future sprints can
 * introduce new writers (`replay-cursor`, `virtualizer`, ...) without needing
 * to extend a fixed enum.
 *
 * Semantics:
 * - `acquire(writer, durationMs)` claims authority for a short window so a
 *   follow-up sync observer (minimap listening to scroll events, for example)
 *   can skip echoing back a write that is still in-flight.
 * - `release(writer)` drops the claim early if the writer finishes sooner.
 * - `isOwnedBy(writer)` is what observers check before re-acting to a scroll.
 * - `owner()` lets debugging panels inspect state.
 *
 * Kept intentionally tiny and dependency-free so any module can import it.
 */

export type ScrollWriter =
  | 'user-scroll'
  | 'minimap'
  | 'navigation'
  | 'virtualizer'
  | 'replay-cursor'
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

  /** Returns true when some *other* writer currently owns the lock. */
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

  /** Test-only reset. */
  _resetForTests(): void {
    lock = null;
    clearExpireTimer();
    listeners.clear();
  },
};
