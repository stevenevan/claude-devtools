import { describe, it, expect } from 'vitest';

import {
  clampPan,
  clampZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  minimapYToScroll,
  neighborChunkBoundary,
  scrollToMinimapY,
  visibleRange,
  zoomAround,
} from '../../../src/renderer/utils/minimapLayout';

describe('clampZoom', () => {
  it('clamps into [MIN_ZOOM, MAX_ZOOM]', () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(MIN_ZOOM);
  });
});

describe('clampPan', () => {
  it('keeps the visible window inside [0,1]', () => {
    expect(clampPan(-0.2, 4)).toBe(0);
    // visible span = 1/4 = 0.25 → max pan = 0.75
    expect(clampPan(0.9, 4)).toBe(0.75);
  });

  it('returns 0 at 1x (full range)', () => {
    expect(clampPan(0.3, 1)).toBe(0);
  });
});

describe('visibleRange', () => {
  it('covers the whole session at 1x', () => {
    expect(visibleRange(1, 0)).toEqual({ startRatio: 0, endRatio: 1 });
  });

  it('shows a 1/N slice at Nx', () => {
    expect(visibleRange(4, 0.25)).toEqual({ startRatio: 0.25, endRatio: 0.5 });
  });
});

describe('scrollToMinimapY + minimapYToScroll roundtrip', () => {
  it('round-trips at 1x', () => {
    const height = 400;
    const scroll = 0.37;
    const y = scrollToMinimapY(scroll, 1, 0, height);
    expect(y).not.toBeNull();
    const back = minimapYToScroll(y ?? 0, 1, 0, height);
    expect(Math.abs(back - scroll)).toBeLessThan(1e-9);
  });

  it('returns null when scroll is outside the zoomed window', () => {
    const y = scrollToMinimapY(0.1, 4, 0.5, 400);
    expect(y).toBeNull();
  });

  it('maps within the visible window at zoom', () => {
    // At zoom=2, pan=0.25 → window [0.25, 0.75]. scroll=0.5 sits at the
    // midpoint, so y should be half the minimap height.
    expect(scrollToMinimapY(0.5, 2, 0.25, 400)).toBeCloseTo(200);
  });
});

describe('zoomAround', () => {
  it('pins the pointed session fraction when zooming in', () => {
    const { zoom, panRatio } = zoomAround(1, 0, 0.5, 2);
    expect(zoom).toBe(2);
    expect(panRatio).toBeCloseTo(0.25);
  });

  it('clamps pan when zooming near an edge', () => {
    const { panRatio } = zoomAround(1, 0, 0, 4);
    expect(panRatio).toBe(0);
  });
});

describe('neighborChunkBoundary', () => {
  const items = [0, 0.2, 0.45, 0.7, 0.9];

  it('returns next boundary', () => {
    expect(neighborChunkBoundary(items, 0.2, 'next')).toBeCloseTo(0.45);
  });

  it('returns prev boundary', () => {
    expect(neighborChunkBoundary(items, 0.5, 'prev')).toBeCloseTo(0.45);
  });

  it('clamps at the ends', () => {
    expect(neighborChunkBoundary(items, 0.95, 'next')).toBeCloseTo(0.9);
    expect(neighborChunkBoundary(items, 0, 'prev')).toBe(0);
  });
});
