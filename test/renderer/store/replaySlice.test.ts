import { describe, expect, it } from 'vitest';
import { create } from 'zustand';

import {
  createReplaySlice,
  replayStepTick,
} from '../../../src/renderer/store/slices/replaySlice';

import type { AppState } from '../../../src/renderer/store/types';

function makeStore() {
  // Only the replay slice is needed for these tests.
  return create<AppState>()((set, get, store) =>
    ({
      ...createReplaySlice(set, get, store),
    }) as AppState
  );
}

describe('replayStepTick', () => {
  it('advances forward', () => {
    expect(replayStepTick(0, 5, 'next')).toBe(1);
  });

  it('clamps at end', () => {
    expect(replayStepTick(4, 5, 'next')).toBe(4);
  });

  it('clamps at 0 going back', () => {
    expect(replayStepTick(0, 5, 'prev')).toBe(0);
  });

  it('returns 0 when empty', () => {
    expect(replayStepTick(0, 0, 'next')).toBe(0);
  });
});

describe('replaySlice', () => {
  it('starts in off mode', () => {
    const useStore = makeStore();
    expect(useStore.getState().replayMode).toBe('off');
  });

  it('enters stepping mode on start and clamps cursor', () => {
    const useStore = makeStore();
    useStore.getState().startReplay(10);
    expect(useStore.getState().replayMode).toBe('stepping');
    expect(useStore.getState().replayCursorIndex).toBe(0);
    expect(useStore.getState().replayTotalChunks).toBe(10);
  });

  it('toggles play/pause only when active', () => {
    const useStore = makeStore();
    useStore.getState().togglePlayPause();
    expect(useStore.getState().replayMode).toBe('off');

    useStore.getState().startReplay(5);
    useStore.getState().togglePlayPause();
    expect(useStore.getState().replayMode).toBe('playing');
    useStore.getState().togglePlayPause();
    expect(useStore.getState().replayMode).toBe('stepping');
  });

  it('pauses when stepping past the end while playing', () => {
    const useStore = makeStore();
    useStore.getState().startReplay(3);
    useStore.getState().togglePlayPause();
    expect(useStore.getState().replayMode).toBe('playing');

    useStore.getState().stepReplay('next');
    useStore.getState().stepReplay('next');
    expect(useStore.getState().replayCursorIndex).toBe(2);
    expect(useStore.getState().replayMode).toBe('stepping');
  });

  it('setReplayCursor clamps to range', () => {
    const useStore = makeStore();
    useStore.getState().startReplay(4);
    useStore.getState().setReplayCursor(100);
    expect(useStore.getState().replayCursorIndex).toBe(3);
    useStore.getState().setReplayCursor(-1);
    expect(useStore.getState().replayCursorIndex).toBe(0);
  });
});
