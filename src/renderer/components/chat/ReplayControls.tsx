import { useEffect } from 'react';

import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { Pause, Play, Square, StepBack, StepForward } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { ReplaySpeed } from '@renderer/store/slices/replaySlice';

const SPEED_OPTIONS: readonly ReplaySpeed[] = [1, 2, 4];

/**
 * Milliseconds per step at 1x speed. Higher speeds divide this by the speed
 * factor so 4x replays 4 chunks per tick window.
 */
const TICK_BASE_MS = 600;

interface ReplayControlsProps {
  totalChunks: number;
}

export const ReplayControls = ({
  totalChunks,
}: Readonly<ReplayControlsProps>): React.JSX.Element | null => {
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

  return (
    <div className="border-border/40 bg-surface-overlay/90 backdrop-blur-md flex shrink-0 items-center gap-2 border-b px-4 py-2 text-xs">
      <button
        onClick={() => stepReplay('prev')}
        className="hover:bg-surface-raised text-text-secondary rounded-sm p-1"
        title="Step back (,)"
      >
        <StepBack className="size-3.5" />
      </button>
      <button
        onClick={() => togglePlayPause()}
        className={cn(
          'hover:bg-surface-raised rounded-sm p-1',
          replayMode === 'playing' ? 'text-amber-400' : 'text-text-secondary'
        )}
        title={replayMode === 'playing' ? 'Pause (space)' : 'Play (space)'}
      >
        {replayMode === 'playing' ? (
          <Pause className="size-3.5" />
        ) : (
          <Play className="size-3.5" />
        )}
      </button>
      <button
        onClick={() => stepReplay('next')}
        className="hover:bg-surface-raised text-text-secondary rounded-sm p-1"
        title="Step forward (.)"
      >
        <StepForward className="size-3.5" />
      </button>
      <button
        onClick={() => stopReplay()}
        className="hover:bg-surface-raised text-text-secondary rounded-sm p-1"
        title="Exit replay"
      >
        <Square className="size-3.5" />
      </button>

      <div className="text-text-muted flex items-center gap-2">
        {SPEED_OPTIONS.map((speed) => (
          <button
            key={speed}
            onClick={() => setReplaySpeed(speed)}
            className={cn(
              'rounded-sm border px-1.5 text-[10px] transition-colors',
              replaySpeed === speed
                ? 'border-amber-400/60 bg-amber-400/10 text-amber-200'
                : 'border-border/40 text-text-secondary hover:bg-surface-raised'
            )}
          >
            {speed}x
          </button>
        ))}
      </div>

      <div className="border-border/40 bg-background relative ml-2 h-1.5 flex-1 overflow-hidden rounded-full border">
        <div
          className="h-full bg-amber-400/70"
          style={{ width: `${Math.min(100, progress * 100)}%` }}
        />
      </div>
      <span className="text-text-muted shrink-0 tabular-nums text-[10px]">
        {Math.min(replayCursorIndex + 1, totalChunks)} / {totalChunks}
      </span>
    </div>
  );
};
