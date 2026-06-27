

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;

export interface MinimapViewport {

  startRatio: number;

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
