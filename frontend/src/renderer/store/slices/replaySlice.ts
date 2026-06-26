/**
 * Replay slice - session playback mode (sprint 27).
 *
 * Drives a cursor over the conversation's chunk items. ReplayControls surfaces
 * play/pause/step buttons; ChatHistory fades chunks whose index exceeds the
 * cursor. Writer identity `replay-cursor` wires through ScrollController so
 * it coexists with user scroll + minimap scrubber without oscillation.
 */

import type { AppState } from '../types';
import type { StateCreator } from 'zustand';

export type ReplayMode = 'off' | 'stepping' | 'playing';
export type ReplaySpeed = 1 | 2 | 4;

export interface ReplaySlice {
  replayMode: ReplayMode;
  replayCursorIndex: number;
  replayTotalChunks: number;
  replaySpeed: ReplaySpeed;

  startReplay: (totalChunks: number) => void;
  stopReplay: () => void;
  togglePlayPause: () => void;
  setReplaySpeed: (speed: ReplaySpeed) => void;
  setReplayCursor: (index: number) => void;
  stepReplay: (direction: 'prev' | 'next') => void;
  setReplayTotalChunks: (total: number) => void;
}

export const replayStepTick = (prev: number, total: number, direction: 'prev' | 'next'): number => {
  if (total <= 0) return 0;
  const next = direction === 'next' ? prev + 1 : prev - 1;
  return Math.max(0, Math.min(total - 1, next));
};

export const createReplaySlice: StateCreator<AppState, [], [], ReplaySlice> = (set, get) => ({
  replayMode: 'off',
  replayCursorIndex: 0,
  replayTotalChunks: 0,
  replaySpeed: 1,

  startReplay: (totalChunks) => {
    set({
      replayMode: 'stepping',
      replayCursorIndex: 0,
      replayTotalChunks: totalChunks,
      replaySpeed: 1,
    });
  },

  stopReplay: () => {
    set({ replayMode: 'off' });
  },

  togglePlayPause: () => {
    const { replayMode } = get();
    if (replayMode === 'off') return;
    set({ replayMode: replayMode === 'playing' ? 'stepping' : 'playing' });
  },

  setReplaySpeed: (speed) => {
    set({ replaySpeed: speed });
  },

  setReplayCursor: (index) => {
    const { replayTotalChunks } = get();
    if (replayTotalChunks <= 0) {
      set({ replayCursorIndex: 0 });
      return;
    }
    set({ replayCursorIndex: Math.max(0, Math.min(replayTotalChunks - 1, index)) });
  },

  stepReplay: (direction) => {
    const { replayCursorIndex, replayTotalChunks, replayMode } = get();
    if (replayMode === 'off') return;
    const next = replayStepTick(replayCursorIndex, replayTotalChunks, direction);
    // If stepping past the end while playing, pause.
    const shouldPause =
      replayMode === 'playing' && direction === 'next' && next === replayTotalChunks - 1;
    set({
      replayCursorIndex: next,
      replayMode: shouldPause ? 'stepping' : replayMode,
    });
  },

  setReplayTotalChunks: (total) => {
    const { replayCursorIndex } = get();
    const clampedTotal = Math.max(0, total);
    set({
      replayTotalChunks: clampedTotal,
      replayCursorIndex: Math.max(0, Math.min(clampedTotal - 1, replayCursorIndex)),
    });
  },
});
