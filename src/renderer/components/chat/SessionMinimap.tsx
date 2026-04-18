/**
 * SessionMinimap - Vertical rail showing a compressed overview of the session.
 * Color-coded by chunk type. Click to jump. Viewport indicator synced to scroll.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@renderer/lib/utils';

import type { ChatItem } from '@renderer/types/groups';

interface SessionMinimapProps {
  items: ChatItem[];
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  onJumpToIndex: (index: number) => void;
  className?: string;
}

/** Color for each chat item type. */
function getItemColor(item: ChatItem): string {
  switch (item.type) {
    case 'user': return 'bg-blue-400/70';
    case 'ai': {
      // High-cost turns get amber
      const tokens = item.group.tokens?.input ?? 0;
      if (tokens > 50000) return 'bg-amber-400/70';
      return 'bg-indigo-400/60';
    }
    case 'system': return 'bg-zinc-400/40';
    case 'compact': return 'bg-zinc-600/30';
    case 'event': {
      // Error events are red
      const eventData = (item.group as { eventData?: { eventType?: string } }).eventData;
      if (eventData?.eventType === 'api_error') return 'bg-red-400/70';
      return 'bg-zinc-400/40';
    }
    default: return 'bg-zinc-500/30';
  }
}

/** Height weight for each item type (relative). */
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

  // Calculate total weight for proportional heights
  const totalWeight = items.reduce((sum, item) => sum + getItemWeight(item), 0);

  // Sync viewport indicator with scroll position
  const updateViewport = useCallback(() => {
    const container = scrollContainerRef.current;
    const minimap = minimapRef.current;
    if (!container || !minimap) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    if (scrollHeight <= 0) return;

    const minimapHeight = minimap.clientHeight;
    const ratio = minimapHeight / scrollHeight;

    setViewportTop(scrollTop * ratio);
    setViewportHeight(Math.max(clientHeight * ratio, 8));
  }, [scrollContainerRef]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.addEventListener('scroll', updateViewport, { passive: true });
    updateViewport();

    // Also update on resize
    const observer = new ResizeObserver(updateViewport);
    observer.observe(container);

    return () => {
      container.removeEventListener('scroll', updateViewport);
      observer.disconnect();
    };
  }, [scrollContainerRef, updateViewport]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const minimap = minimapRef.current;
      if (!minimap) return;

      const rect = minimap.getBoundingClientRect();
      const clickY = e.clientY - rect.top;
      const ratio = clickY / rect.height;

      // Find the item at this ratio position
      let accumulated = 0;
      for (let i = 0; i < items.length; i++) {
        accumulated += getItemWeight(items[i]);
        if (accumulated / totalWeight >= ratio) {
          onJumpToIndex(i);
          return;
        }
      }
      // Default to last item
      if (items.length > 0) {
        onJumpToIndex(items.length - 1);
      }
    },
    [items, totalWeight, onJumpToIndex]
  );

  if (items.length < 5) return null;

  return (
    <div
      ref={minimapRef}
      className={cn(
        'relative w-2.5 shrink-0 cursor-pointer',
        className
      )}
      onClick={handleClick}
      title="Click to navigate"
    >
      {/* Item bars */}
      <div className="flex h-full flex-col gap-px py-1">
        {items.map((item) => {
          const weight = getItemWeight(item);
          const heightPct = (weight / totalWeight) * 100;
          return (
            <div
              key={item.group.id}
              className={cn('min-h-px rounded-full', getItemColor(item))}
              style={{ flexGrow: heightPct }}
            />
          );
        })}
      </div>

      {/* Viewport indicator */}
      <div
        className="pointer-events-none absolute inset-x-0 rounded-xs border border-white/20 bg-white/5"
        style={{
          top: `${viewportTop}px`,
          height: `${viewportHeight}px`,
        }}
      />
    </div>
  );
};
