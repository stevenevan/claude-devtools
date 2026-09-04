import { JSX, ReactNode, useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import { cn } from '@renderer/lib/utils';

import { Skeleton } from '../ui/skeleton';

export const VIRTUAL_LIST_THRESHOLD = 100;
export const VIRTUAL_LIST_OVERSCAN = 5;
export const VIRTUAL_LIST_DEFAULT_ESTIMATE = 64;

export type VirtualListMode = 'plain' | 'windowed';

export interface VirtualListPlan {
  mode: VirtualListMode;
  overscan: number;
}

export function resolveVirtualListPlan(
  count: number,
  threshold: number = VIRTUAL_LIST_THRESHOLD,
  overscan: number = VIRTUAL_LIST_OVERSCAN
): VirtualListPlan {
  return {
    mode: count > threshold ? 'windowed' : 'plain',
    overscan: Math.max(0, Math.floor(overscan)),
  };
}

const scrollPositions = new Map<string, number>();

export function saveVirtualListScroll(key: string, top: number): void {
  if (Number.isFinite(top)) scrollPositions.set(key, top);
}

export function readVirtualListScroll(key: string): number | undefined {
  return scrollPositions.get(key);
}

export function clearVirtualListScroll(key?: string): void {
  if (key === undefined) {
    scrollPositions.clear();
  } else {
    scrollPositions.delete(key);
  }
}

export interface VirtualListProps<T> {
  items: readonly T[];
  getItemKey: (item: T, index: number) => string | number;
  estimateSize?: (item: T, index: number) => number;
  renderItem: (item: T, index: number) => ReactNode;
  ariaLabel: string;
  overscan?: number;
  threshold?: number;
  scrollKey?: string;
  scrollContainerRef?: { current: HTMLElement | null };
  className?: string;
  rowClassName?: string;
}

function measureRow(element: HTMLElement): number {
  return element.getBoundingClientRect().height;
}

export function VirtualList<T>({
  items,
  getItemKey,
  estimateSize,
  renderItem,
  ariaLabel,
  overscan = VIRTUAL_LIST_OVERSCAN,
  threshold = VIRTUAL_LIST_THRESHOLD,
  scrollKey,
  scrollContainerRef,
  className,
  rowClassName,
}: Readonly<VirtualListProps<T>>): JSX.Element {
  const plan = resolveVirtualListPlan(items.length, threshold, overscan);
  const ownScrollRef = useRef<HTMLDivElement>(null);

  const getScrollElement = (): HTMLElement | null =>
    scrollContainerRef?.current ?? ownScrollRef.current;

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual API limitation, not fixable in user code
  const rowVirtualizer = useVirtualizer({
    count: plan.mode === 'windowed' ? items.length : 0,
    getScrollElement,
    estimateSize: (index) => {
      const item = items[index];
      if (item === undefined) return VIRTUAL_LIST_DEFAULT_ESTIMATE;
      return estimateSize?.(item, index) ?? VIRTUAL_LIST_DEFAULT_ESTIMATE;
    },
    getItemKey: (index) => {
      const item = items[index];
      return item === undefined ? index : getItemKey(item, index);
    },
    measureElement: measureRow,
    overscan: plan.overscan,
  });

  useEffect(() => {
    if (!scrollKey) return;
    const target = scrollContainerRef?.current ?? ownScrollRef.current;
    if (!target) return;
    const saved = readVirtualListScroll(scrollKey);
    if (saved !== undefined) target.scrollTop = saved;
    const onScroll = (): void => saveVirtualListScroll(scrollKey, target.scrollTop);
    target.addEventListener('scroll', onScroll, { passive: true });
    return () => target.removeEventListener('scroll', onScroll);
  }, [scrollKey, scrollContainerRef, plan.mode]);

  if (plan.mode === 'plain') {
    const rows = items.map((item, index) => (
      <div
        key={getItemKey(item, index)}
        role="listitem"
        aria-setsize={items.length}
        aria-posinset={index + 1}
        className={rowClassName}
      >
        {renderItem(item, index)}
      </div>
    ));
    if (scrollContainerRef) {
      return (
        <div role="list" aria-label={ariaLabel}>
          {rows}
        </div>
      );
    }
    return (
      <div ref={ownScrollRef} role="list" aria-label={ariaLabel} className={cn('flex-1 overflow-y-auto', className)}>
        {rows}
      </div>
    );
  }

  const virtualRows = rowVirtualizer.getVirtualItems();
  const window = (
    <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
      {virtualRows.map((virtualRow) => {
        const item = items[virtualRow.index];
        if (item === undefined) return null;
        return (
          <div
            key={rowVirtualizer.options.getItemKey(virtualRow.index)}
            ref={rowVirtualizer.measureElement}
            data-index={virtualRow.index}
            role="listitem"
            aria-setsize={items.length}
            aria-posinset={virtualRow.index + 1}
            className={cn('absolute top-0 left-0 w-full', rowClassName)}
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            {renderItem(item, virtualRow.index)}
          </div>
        );
      })}
    </div>
  );

  if (scrollContainerRef) {
    return (
      <div role="list" aria-label={ariaLabel}>
        {window}
      </div>
    );
  }

  return (
    <div
      ref={ownScrollRef}
      role="list"
      aria-label={ariaLabel}
      className={cn('flex-1 overflow-y-auto', className)}
    >
      {window}
    </div>
  );
}

export function VirtualListSkeleton({
  rows = 8,
  ariaLabel = 'Loading items',
}: Readonly<{ rows?: number; ariaLabel?: string }>): JSX.Element {
  return (
    <div role="status" aria-label={ariaLabel} className="flex flex-1 flex-col gap-3 p-4">
      <span className="sr-only">{ariaLabel}…</span>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex flex-col gap-1.5" aria-hidden="true">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}
