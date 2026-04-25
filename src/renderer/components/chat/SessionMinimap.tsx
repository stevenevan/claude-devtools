/**
 * SessionMinimap - Vertical rail showing a compressed overview of the session.
 * Color-coded by chunk type. Click to jump. Viewport indicator synced to scroll.
 * Sprint 26: wheel-to-zoom (1x–8x), drag-to-pan, scrubber handle via
 * ScrollController authority protocol.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import {
  clampPan,
  clampZoom,
  MIN_ZOOM,
  minimapYToScroll,
  scrollToMinimapY,
  visibleRange,
  zoomAround,
} from '@renderer/utils/minimapLayout';
import { scrollController } from '@renderer/utils/scrollController';
import { useShallow } from 'zustand/react/shallow';

import { getAnnotationColorHex } from './annotationColors';

import type { ChatItem } from '@renderer/types/groups';

interface SessionMinimapProps {
  items: ChatItem[];
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  onJumpToIndex: (index: number) => void;
  className?: string;
}

function getItemColor(item: ChatItem): string {
  switch (item.type) {
    case 'user': return 'bg-blue-400/70';
    case 'ai': {
      const tokens = item.group.tokens?.input ?? 0;
      if (tokens > 50000) return 'bg-amber-400/70';
      return 'bg-indigo-400/60';
    }
    case 'system': return 'bg-zinc-400/40';
    case 'compact': return 'bg-zinc-600/30';
    case 'event': {
      const eventData = (item.group as { eventData?: { eventType?: string } }).eventData;
      if (eventData?.eventType === 'api_error') return 'bg-red-400/70';
      return 'bg-zinc-400/40';
    }
    default: return 'bg-zinc-500/30';
  }
}

function getItemWeight(item: ChatItem): number {
  switch (item.type) {
    case 'ai': return 3;
    case 'user': return 1.5;
    case 'system': return 1;
    case 'compact': return 0.5;
    case 'event': return 0.5;
    default: return 1;
  }
}

export const SessionMinimap = ({
  items,
  scrollContainerRef,
  onJumpToIndex,
  className,
}: Readonly<SessionMinimapProps>): React.JSX.Element | null => {
  const minimapRef = useRef<HTMLDivElement>(null);
  const [viewportTop, setViewportTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(100);
  const [zoom, setZoom] = useState(1);
  const [panRatio, setPanRatio] = useState(0);
  const [playheadPct, setPlayheadPct] = useState<number | null>(null);
  const dragState = useRef<{ kind: 'pan' | 'scrub'; startY: number; startPan: number } | null>(
    null
  );

  const { bookmarks, annotations } = useStore(
    useShallow((s) => ({
      bookmarks: s.bookmarks,
      annotations: s.annotations,
    }))
  );

  const bookmarkedIds = useMemo(() => new Set(bookmarks.map((b) => b.groupId)), [bookmarks]);
  const annotationByTarget = useMemo(() => {
    const map = new Map<string, string>();
    for (const annotation of annotations) {
      if (!map.has(annotation.targetId)) {
        map.set(annotation.targetId, annotation.color);
      }
    }
    return map;
  }, [annotations]);

  const totalWeight = items.reduce((sum, item) => sum + getItemWeight(item), 0);

  const updateViewport = useCallback(() => {
    const container = scrollContainerRef.current;
    const minimap = minimapRef.current;
    if (!container || !minimap) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    if (scrollHeight <= 0) return;

    const scrollRatio = scrollTop / Math.max(scrollHeight - clientHeight, 1);
    const minimapHeight = minimap.clientHeight;

    const { startRatio, endRatio } = visibleRange(zoom, panRatio);
    const span = Math.max(endRatio - startRatio, 1e-6);
    const windowRatio = clientHeight / scrollHeight;

    // Viewport rectangle on minimap.
    const relStart = Math.max(0, Math.min(1, (scrollTop / scrollHeight - startRatio) / span));
    const relHeight = Math.max(0.02, Math.min(1, windowRatio / span));
    setViewportTop(relStart * minimapHeight);
    setViewportHeight(Math.max(relHeight * minimapHeight, 8));

    // Playhead (centre of viewport) — null when outside the zoomed window.
    const y = scrollToMinimapY(scrollRatio, zoom, panRatio, minimapHeight);
    setPlayheadPct(y === null ? null : y / minimapHeight);
  }, [scrollContainerRef, zoom, panRatio]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.addEventListener('scroll', updateViewport, { passive: true });
    updateViewport();

    const observer = new ResizeObserver(updateViewport);
    observer.observe(container);

    return () => {
      container.removeEventListener('scroll', updateViewport);
      observer.disconnect();
    };
  }, [scrollContainerRef, updateViewport]);

  const applyScrollRatio = useCallback(
    (ratio: number, writer: 'minimap' | 'navigation' = 'minimap') => {
      const container = scrollContainerRef.current;
      if (!container) return;
      const target = ratio * Math.max(container.scrollHeight - container.clientHeight, 0);
      scrollController.acquire(writer, 220);
      container.scrollTo({ top: target, behavior: 'smooth' });
    },
    [scrollContainerRef]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // Suppress click right after a drag so scrubbing doesn't snap to a click.
      if (dragState.current) {
        dragState.current = null;
        return;
      }
      const minimap = minimapRef.current;
      if (!minimap) return;

      const rect = minimap.getBoundingClientRect();
      const clickY = e.clientY - rect.top;
      const ratio = minimapYToScroll(clickY, zoom, panRatio, rect.height);

      // Find item nearest the click for turn-navigation semantics.
      let accumulated = 0;
      for (let i = 0; i < items.length; i++) {
        accumulated += getItemWeight(items[i]);
        if (accumulated / totalWeight >= ratio) {
          onJumpToIndex(i);
          return;
        }
      }
      if (items.length > 0) onJumpToIndex(items.length - 1);
    },
    [items, totalWeight, onJumpToIndex, zoom, panRatio]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      const minimap = minimapRef.current;
      if (!minimap) return;
      e.preventDefault();
      const rect = minimap.getBoundingClientRect();
      const pointer = (e.clientY - rect.top) / rect.height;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const result = zoomAround(zoom, panRatio, pointer, factor);
      setZoom(result.zoom);
      setPanRatio(result.panRatio);
    },
    [zoom, panRatio]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      // Shift-drag pans (when zoomed); plain drag scrubs playhead.
      dragState.current = {
        kind: e.shiftKey && zoom > 1 ? 'pan' : 'scrub',
        startY: e.clientY,
        startPan: panRatio,
      };
    },
    [panRatio, zoom]
  );

  useEffect(() => {
    const handleMove = (e: MouseEvent): void => {
      const minimap = minimapRef.current;
      const state = dragState.current;
      if (!state || !minimap) return;
      const rect = minimap.getBoundingClientRect();
      if (state.kind === 'pan') {
        const delta = (e.clientY - state.startY) / rect.height;
        setPanRatio(clampPan(state.startPan - delta, zoom));
      } else {
        const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
        const ratio = minimapYToScroll(y, zoom, panRatio, rect.height);
        applyScrollRatio(ratio, 'minimap');
      }
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
  }, [applyScrollRatio, panRatio, zoom]);

  if (items.length < 5) return null;

  return (
    <div
      ref={minimapRef}
      role="button"
      tabIndex={0}
      aria-label={`Session minimap (zoom ${zoom.toFixed(1)}x)`}
      className={cn('relative w-4 shrink-0 cursor-pointer select-none', className)}
      onClick={handleClick}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onKeyDown={(e) => {
        if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          setZoom((z) => clampZoom(z * 1.25));
        } else if (e.key === '-') {
          e.preventDefault();
          setZoom((z) => clampZoom(z / 1.25));
        } else if (e.key === '0') {
          e.preventDefault();
          setZoom(MIN_ZOOM);
          setPanRatio(0);
        }
      }}
      title={`Scroll to zoom · Shift+drag to pan · 0 resets (${zoom.toFixed(1)}x)`}
    >
      {/* Visible slice body — the items inside the zoomed window fill the
          minimap; items outside are hidden. */}
      <div className="flex h-full flex-col gap-px py-1">
        {items.map((item, idx) => {
          const weight = getItemWeight(item);
          const start =
            (items.slice(0, idx).reduce((s, it) => s + getItemWeight(it), 0)) / totalWeight;
          const end = start + weight / totalWeight;
          const { startRatio, endRatio } = visibleRange(zoom, panRatio);
          if (end < startRatio || start > endRatio) return null;

          const clampedStart = Math.max(start, startRatio);
          const clampedEnd = Math.min(end, endRatio);
          const span = endRatio - startRatio;
          const heightPct = ((clampedEnd - clampedStart) / span) * 100;

          const isBookmarked = bookmarkedIds.has(item.group.id);
          const annotationColor = annotationByTarget.get(item.group.id);
          return (
            <div
              key={item.group.id}
              className="relative flex items-center"
              style={{ flexGrow: heightPct }}
            >
              <div className={cn('min-h-px w-2 flex-1 rounded-full', getItemColor(item))} />
              {zoom >= 4 && item.type === 'ai' && (
                <span
                  aria-hidden
                  className="text-text-muted absolute -right-1 top-1/2 size-1 -translate-y-1/2 rounded-full bg-violet-400"
                />
              )}
              {isBookmarked && (
                <span
                  aria-hidden
                  className="absolute right-0 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-amber-400"
                />
              )}
              {annotationColor && (
                <span
                  aria-hidden
                  className="absolute right-[5px] top-1/2 size-1.5 -translate-y-1/2 rounded-full"
                  style={{ backgroundColor: getAnnotationColorHex(annotationColor) }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Zoom indicator badge (only when zoomed in) */}
      {zoom > 1 && (
        <span className="text-text-muted absolute -left-6 top-1 rounded-[2px] bg-black/40 px-1 font-mono text-[8px]">
          {zoom.toFixed(1)}x
        </span>
      )}

      {/* Viewport indicator */}
      <div
        className="pointer-events-none absolute inset-x-0 rounded-xs border border-white/20 bg-white/5"
        style={{
          top: `${viewportTop}px`,
          height: `${viewportHeight}px`,
        }}
      />

      {/* Scrubber handle (playhead) */}
      {playheadPct !== null && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 h-[2px] bg-amber-300"
          style={{ top: `calc(${(playheadPct * 100).toFixed(3)}% - 1px)` }}
        />
      )}
    </div>
  );
};

