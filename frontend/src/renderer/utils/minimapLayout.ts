/**
 * Minimap layout math — converts between chat scroll position and minimap
 * coordinates under a zoom factor.
 *
 * Zoom semantics:
 * - 1x shows the whole session in the minimap viewport.
 * - N x shows 1/N of the session; `panRatio` slides the visible window.
 * - `panRatio` is clamped so the visible window stays inside [0,1].
 */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;

export interface MinimapViewport {
  /** Start of the visible slice in session fraction [0,1]. */
  startRatio: number;
  /** End of the visible slice in session fraction [0,1]. */
  endRatio: number;
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function clampPan(panRatio: number, zoom: number): number {
  const z = clampZoom(zoom);
  const span = 1 / z;
  const maxPan = 1 - span;
  if (maxPan <= 0) return 0;
  return Math.min(maxPan, Math.max(0, panRatio));
}

export function visibleRange(zoom: number, panRatio: number): MinimapViewport {
  const z = clampZoom(zoom);
  const pan = clampPan(panRatio, z);
  const span = 1 / z;
  return { startRatio: pan, endRatio: pan + span };
}

/**
 * Scroll progress (0..1) of the chat container → minimap Y coordinate (px)
 * under the current zoom/pan. Returns null when the scroll position is
 * outside the visible slice.
 */
export function scrollToMinimapY(
  scrollRatio: number,
  zoom: number,
  panRatio: number,
  minimapHeight: number
): number | null {
  const { startRatio, endRatio } = visibleRange(zoom, panRatio);
  if (scrollRatio < startRatio || scrollRatio > endRatio) return null;
  const localRatio = (scrollRatio - startRatio) / (endRatio - startRatio);
  return localRatio * minimapHeight;
}

/**
 * Minimap Y (px, 0..minimapHeight) → scroll ratio (0..1) on the chat
 * container under the current zoom/pan.
 */
export function minimapYToScroll(
  y: number,
  zoom: number,
  panRatio: number,
  minimapHeight: number
): number {
  if (minimapHeight <= 0) return 0;
  const localRatio = Math.min(1, Math.max(0, y / minimapHeight));
  const { startRatio, endRatio } = visibleRange(zoom, panRatio);
  return startRatio + localRatio * (endRatio - startRatio);
}

/**
 * Given a desired zoom delta centered at a pointer position on the minimap,
 * compute the new zoom + pan so the pointer stays pinned on the same
 * session fraction.
 */
export function zoomAround(
  prevZoom: number,
  prevPan: number,
  pointerRatio: number,
  zoomDelta: number
): { zoom: number; panRatio: number } {
  const pointerLocal = Math.min(1, Math.max(0, pointerRatio));
  const { startRatio, endRatio } = visibleRange(prevZoom, prevPan);
  const sessionRatio = startRatio + pointerLocal * (endRatio - startRatio);

  const nextZoom = clampZoom(prevZoom * zoomDelta);
  const span = 1 / nextZoom;
  const nextStart = clampPan(sessionRatio - pointerLocal * span, nextZoom);
  return { zoom: nextZoom, panRatio: nextStart };
}

/**
 * Find the nearest chunk boundary (start of an item) in either direction from
 * the current scroll ratio. Returns the new scroll ratio to jump to, or the
 * current one if no boundary exists.
 */
export function neighborChunkBoundary(
  itemStartRatios: readonly number[],
  currentRatio: number,
  direction: 'prev' | 'next'
): number {
  if (itemStartRatios.length === 0) return currentRatio;
  if (direction === 'next') {
    for (const r of itemStartRatios) {
      if (r > currentRatio + 1e-6) return r;
    }
    return itemStartRatios[itemStartRatios.length - 1];
  }
  let prev = itemStartRatios[0];
  for (const r of itemStartRatios) {
    if (r >= currentRatio - 1e-6) break;
    prev = r;
  }
  return prev;
}
