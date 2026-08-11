import { JSX, useEffect } from 'react';
import { Button } from '@renderer/components/ui/button';
import { Progress } from '@renderer/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@renderer/components/ui/radio-group';
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
  const progressPercent = Math.min(100, Math.max(0, progress * 100));
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
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={() => stepReplay('prev')}
        className="hover:bg-surface-raised text-text-secondary focus-visible:ring-primary rounded-sm focus-visible:ring-2 focus-visible:outline-none"
        title="Step back (,)"
        aria-label="Step back one chunk"
      >
        <StepBack className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={() => togglePlayPause()}
        className={cn(
          'hover:bg-surface-raised focus-visible:ring-primary rounded-sm focus-visible:ring-2 focus-visible:outline-none',
          isPlaying ? 'text-amber-400' : 'text-text-secondary'
        )}
        title={isPlaying ? 'Pause (space)' : 'Play (space)'}
        aria-label={isPlaying ? 'Pause replay' : 'Play replay'}
        aria-pressed={isPlaying}
      >
        {isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={() => stepReplay('next')}
        className="hover:bg-surface-raised text-text-secondary focus-visible:ring-primary rounded-sm focus-visible:ring-2 focus-visible:outline-none"
        title="Step forward (.)"
        aria-label="Step forward one chunk"
      >
        <StepForward className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={() => stopReplay()}
        className="hover:bg-surface-raised text-text-secondary focus-visible:ring-primary rounded-sm focus-visible:ring-2 focus-visible:outline-none"
        title="Exit replay"
        aria-label="Exit replay mode"
      >
        <Square className="size-3.5" />
      </Button>

      <RadioGroup
        value={replaySpeed}
        onValueChange={(value) => setReplaySpeed(value as ReplaySpeed)}
        aria-label="Replay speed"
        className="text-text-muted flex w-auto items-center gap-2"
      >
        {SPEED_OPTIONS.map((speed) => (
          <div key={speed} className="relative h-5">
            <RadioGroupItem
              value={speed}
              aria-label={`${speed}x`}
              className={cn(
                'absolute inset-0 aspect-auto size-auto rounded-sm border px-1.5 text-[10px] transition-colors after:hidden focus-visible:ring-primary focus-visible:ring-2 focus-visible:outline-none [&_[data-slot=radio-group-indicator]]:hidden',
                replaySpeed === speed
                  ? 'border-amber-400/60 bg-amber-400/10 text-amber-200'
                  : 'border-border/40 text-text-secondary hover:bg-surface-raised'
              )}
            />
            <span className="pointer-events-none relative px-1.5 text-[10px] leading-5">
              {speed}x
            </span>
          </div>
        ))}
      </RadioGroup>

      <Progress
        value={progressPercent}
        aria-label="Replay progress"
        aria-valuetext={`${Math.round(progressPercent)}%`}
        className="border-border/40 bg-background relative ml-2 flex-1 rounded-full border"
        indicatorClassName="bg-amber-400/70"
      />
      <span className="text-text-muted shrink-0 text-[10px] tabular-nums">
        {Math.min(replayCursorIndex + 1, totalChunks)} / {totalChunks}
      </span>
    </div>
  );
};
