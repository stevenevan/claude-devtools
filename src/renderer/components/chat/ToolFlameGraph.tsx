import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@renderer/lib/utils';
import { buildFlameLayout } from '@renderer/utils/flameGraphLayout';
import { formatTokensCompact } from '@shared/utils/tokenFormatting';

import type { FlameBar, ToolCategory } from '@renderer/utils/flameGraphLayout';
import type { Chunk } from '@shared/types/chunks';

const ROW_HEIGHT = 18;
const ROW_GAP = 2;
const MIN_BAR_WIDTH = 2;
const MIN_SCALE = 1e-4; // px per ms — fit full session at minimum
const MAX_SCALE = 2; // px per ms — deep zoom
const ZOOM_FACTOR = 1.15;

const CATEGORY_COLOR: Record<ToolCategory, string> = {
  bash: 'bg-amber-500/80',
  edit: 'bg-emerald-500/80',
  read: 'bg-sky-500/80',
  search: 'bg-violet-500/80',
  task: 'bg-rose-500/80',
  fetch: 'bg-cyan-500/80',
  other: 'bg-slate-400/80',
};

interface ToolFlameGraphProps {
  chunks: Chunk[];
  /** Tool call id to spotlight (from external selection). */
  focusedToolCallId?: string | null;
  onBarClick?: (bar: FlameBar) => void;
  className?: string;
}

interface TooltipState {
  bar: FlameBar;
  x: number;
  y: number;
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function tokensSent(bar: FlameBar): number {
  return bar.durationMs;
}

export const ToolFlameGraph = ({
  chunks,
  focusedToolCallId,
  onBarClick,
  className,
}: Readonly<ToolFlameGraphProps>): React.JSX.Element | null => {
  const layout = useMemo(() => buildFlameLayout({ chunks }), [chunks]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [scale, setScale] = useState<number | null>(null);
  const [pan, setPan] = useState(0);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const dragState = useRef<{ startX: number; startPan: number } | null>(null);

  const totalMs = Math.max(layout.sessionEndMs - layout.sessionStartMs, 1);

  // Track container width
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) {
        setContainerWidth(e.contentRect.width);
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Initialize scale to fit container
  useEffect(() => {
    if (scale === null && containerWidth > 0 && totalMs > 0) {
      setScale(containerWidth / totalMs);
    }
  }, [containerWidth, totalMs, scale]);

  const effectiveScale = scale ?? (containerWidth > 0 ? containerWidth / totalMs : 1);

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        // Horizontal trackpad pan — let native scroll handle; fall through to pan.
      }
      e.preventDefault();
      const el = scrollRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const pointerMs = (mouseX - pan) / effectiveScale;

      const delta = e.deltaY;
      const nextScale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, effectiveScale * (delta < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR))
      );
      if (nextScale === effectiveScale) return;

      // Keep the hovered timestamp pinned under the cursor.
      const nextPan = mouseX - pointerMs * nextScale;
      setScale(nextScale);
      setPan(nextPan);
    },
    [effectiveScale, pan]
  );

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    dragState.current = { startX: e.clientX, startPan: pan };
  };

  useEffect(() => {
    const handleMove = (e: MouseEvent): void => {
      if (!dragState.current) return;
      const next = dragState.current.startPan + (e.clientX - dragState.current.startX);
      setPan(next);
    };
    const handleUp = (): void => {
      dragState.current = null;
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, []);

  // Focus helper — center the focused bar and bump zoom a bit.
  useEffect(() => {
    if (!focusedToolCallId || !layout.bars.length || containerWidth === 0) return;
    const bar = layout.bars.find((b) => b.id === focusedToolCallId);
    if (!bar) return;
    const barStartMs = bar.startMs - layout.sessionStartMs;
    const barDurationMs = Math.max(bar.endMs - bar.startMs, 1);
    const desiredScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (containerWidth * 0.4) / barDurationMs));
    const centerPan = containerWidth / 2 - barStartMs * desiredScale - (barDurationMs * desiredScale) / 2;
    setScale(desiredScale);
    setPan(centerPan);
  }, [focusedToolCallId, layout, containerWidth]);

  if (layout.bars.length === 0) {
    return (
      <div
        className={cn(
          'border-border text-text-muted rounded-xs border px-4 py-6 text-center text-xs',
          className
        )}
      >
        No tool executions to visualize
      </div>
    );
  }

  const heightPx = (layout.maxDepth + 1) * (ROW_HEIGHT + ROW_GAP) + ROW_GAP;

  return (
    <div className={cn('border-border bg-background/50 rounded-xs border', className)}>
      <div className="border-border/50 flex items-center justify-between border-b px-3 py-1.5 text-[10px]">
        <span className="text-text-muted">
          {layout.bars.length} tools · {formatDurationMs(totalMs)} · depth {layout.maxDepth + 1}
        </span>
        <span className="text-text-muted">Scroll to zoom · drag to pan · click for details</span>
      </div>
      <div
        ref={scrollRef}
        role="presentation"
        className="relative overflow-hidden"
        style={{ height: heightPx, cursor: dragState.current ? 'grabbing' : 'grab' }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseLeave={() => setTooltip(null)}
      >
        {layout.bars.map((bar) => {
          const relStartMs = bar.startMs - layout.sessionStartMs;
          const leftPx = relStartMs * effectiveScale + pan;
          const widthPx = Math.max((bar.endMs - bar.startMs) * effectiveScale, MIN_BAR_WIDTH);
          const topPx = bar.depth * (ROW_HEIGHT + ROW_GAP) + ROW_GAP;

          // Skip bars offscreen (simple culling).
          if (leftPx + widthPx < 0 || leftPx > containerWidth) return null;

          return (
            <button
              key={bar.id}
              type="button"
              className={cn(
                'absolute flex items-center overflow-hidden rounded-[2px] px-1 text-left font-mono text-[10px] leading-none text-white/90',
                CATEGORY_COLOR[bar.category],
                bar.isError && 'ring-1 ring-red-500',
                focusedToolCallId === bar.id && 'ring-1 ring-white'
              )}
              style={{
                left: leftPx,
                top: topPx,
                width: widthPx,
                height: ROW_HEIGHT,
              }}
              onMouseEnter={(e) => {
                const rect = scrollRef.current?.getBoundingClientRect();
                if (!rect) return;
                setTooltip({ bar, x: e.clientX - rect.left, y: e.clientY - rect.top });
              }}
              onMouseMove={(e) => {
                const rect = scrollRef.current?.getBoundingClientRect();
                if (!rect) return;
                setTooltip({ bar, x: e.clientX - rect.left, y: e.clientY - rect.top });
              }}
              onMouseLeave={() => setTooltip(null)}
              onClick={(e) => {
                e.stopPropagation();
                onBarClick?.(bar);
              }}
            >
              {widthPx > 24 ? bar.label : ''}
            </button>
          );
        })}

        {tooltip && (
          <div
            className="border-border bg-surface-overlay pointer-events-none absolute z-10 rounded-xs border px-2 py-1 text-[10px] shadow-lg"
            style={{
              left: Math.min(tooltip.x + 12, containerWidth - 180),
              top: Math.min(tooltip.y + 12, heightPx - 60),
            }}
          >
            <div className="text-text text-[11px] font-medium">{tooltip.bar.label}</div>
            <div className="text-text-muted mt-0.5">
              {formatDurationMs(tooltip.bar.durationMs)} · {tooltip.bar.category}
            </div>
            {tooltip.bar.isError && <div className="mt-0.5 text-red-300">Errored</div>}
            {tokensSent(tooltip.bar) > 0 && (
              <div className="text-text-muted mt-0.5">
                Δ {formatTokensCompact(tokensSent(tooltip.bar))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
