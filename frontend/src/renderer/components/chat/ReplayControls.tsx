import { JSX, useEffect } from 'react';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { Pause, Play, Square, StepBack, StepForward } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { ReplaySpeed } from '@renderer/store/slices/replaySlice';

const SPEED_OPTIONS: readonly ReplaySpeed[] = [1, 2, 4];

const TICK_BASE_MS = 600;

interface ReplayControlsProps {
  totalChunks: number;
}

export const ReplayControls = ({
  totalChunks,
}: Readonly<ReplayControlsProps>): JSX.Element | null => {
  const {
    replayMode,
    replayCursorIndex,
    replaySpeed,
    togglePlayPause,
    stopReplay,
    stepReplay,
    setReplaySpeed,
    setReplayTotalChunks,
  } = useStore(
    useShallow((s) => ({
      replayMode: s.replayMode,
      replayCursorIndex: s.replayCursorIndex,
      replaySpeed: s.replaySpeed,
      togglePlayPause: s.togglePlayPause,
      stopReplay: s.stopReplay,
      stepReplay: s.stepReplay,
      setReplaySpeed: s.setReplaySpeed,
      setReplayTotalChunks: s.setReplayTotalChunks,
    }))
  );

  useEffect(() => {
    if (replayMode === 'off') return;
    setReplayTotalChunks(totalChunks);
  }, [replayMode, totalChunks, setReplayTotalChunks]);

  useEffect(() => {
    if (replayMode !== 'playing') return;
    const intervalMs = Math.max(40, TICK_BASE_MS / replaySpeed);
    const timer = setInterval(() => {
      stepReplay('next');
    }, intervalMs);
    return () => clearInterval(timer);
  }, [replayMode, replaySpeed, stepReplay]);

  if (replayMode === 'off') return null;

  const progress = totalChunks > 0 ? (replayCursorIndex + 1) / totalChunks : 0;
  const isPlaying = replayMode === 'playing';
  const liveAnnouncement = isPlaying
    ? `Replay playing at ${replaySpeed}x, chunk ${replayCursorIndex + 1} of ${totalChunks}`
    : `Replay paused at chunk ${replayCursorIndex + 1} of ${totalChunks}`;

  return (
    <div
      role="region"
      aria-label="Session replay controls"
      className="border-border/40 bg-surface-overlay/90 flex shrink-0 items-center gap-2 border-b px-4 py-2 text-xs backdrop-blur-md"
    >
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </span>
      <button
        type="button"
        onClick={() => stepReplay('prev')}
        className="hover:bg-surface-raised text-text-secondary focus-visible:ring-primary rounded-sm p-1 focus-visible:ring-2 focus-visible:outline-none"
        title="Step back (,)"
        aria-label="Step back one chunk"
      >
        <StepBack className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={() => togglePlayPause()}
        className={cn(
          'hover:bg-surface-raised focus-visible:ring-primary rounded-sm p-1 focus-visible:ring-2 focus-visible:outline-none',
          isPlaying ? 'text-amber-400' : 'text-text-secondary'
        )}
        title={isPlaying ? 'Pause (space)' : 'Play (space)'}
        aria-label={isPlaying ? 'Pause replay' : 'Play replay'}
        aria-pressed={isPlaying}
      >
        {isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
      </button>
      <button
        type="button"
        onClick={() => stepReplay('next')}
        className="hover:bg-surface-raised text-text-secondary focus-visible:ring-primary rounded-sm p-1 focus-visible:ring-2 focus-visible:outline-none"
        title="Step forward (.)"
        aria-label="Step forward one chunk"
      >
        <StepForward className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={() => stopReplay()}
        className="hover:bg-surface-raised text-text-secondary focus-visible:ring-primary rounded-sm p-1 focus-visible:ring-2 focus-visible:outline-none"
        title="Exit replay"
        aria-label="Exit replay mode"
      >
        <Square className="size-3.5" />
      </button>

      <div
        role="radiogroup"
        aria-label="Replay speed"
        className="text-text-muted flex items-center gap-2"
      >
        {SPEED_OPTIONS.map((speed) => (
          <button
            key={speed}
            type="button"
            role="radio"
            aria-checked={replaySpeed === speed}
            onClick={() => setReplaySpeed(speed)}
            className={cn(
              'focus-visible:ring-primary rounded-sm border px-1.5 text-[10px] transition-colors focus-visible:ring-2 focus-visible:outline-none',
              replaySpeed === speed
                ? 'border-amber-400/60 bg-amber-400/10 text-amber-200'
                : 'border-border/40 text-text-secondary hover:bg-surface-raised'
            )}
          >
            {speed}x
          </button>
        ))}
      </div>

      <div
        role="progressbar"
        aria-label="Replay progress"
        aria-valuenow={Math.round(progress * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="border-border/40 bg-background relative ml-2 h-1.5 flex-1 overflow-hidden rounded-full border"
      >
        <div
          className="h-full bg-amber-400/70"
          style={{ width: `${Math.min(100, progress * 100)}%` }}
        />
      </div>
      <span className="text-text-muted shrink-0 text-[10px] tabular-nums">
        {Math.min(replayCursorIndex + 1, totalChunks)} / {totalChunks}
      </span>
    </div>
  );
};
