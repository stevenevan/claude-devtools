import { describe, expect, it } from 'vitest';

import { isNearBottom } from '../../../src/renderer/hooks/useAutoScrollBottom';

describe('isNearBottom', () => {
  it('returns true when distance from bottom is within threshold', () => {
    // scrollTop=850, scrollHeight=1000, clientHeight=100 → distance = 1000-850-100 = 50
    expect(isNearBottom(850, 1000, 100, 50)).toBe(true);
  });

  it('returns false when distance from bottom exceeds threshold', () => {
    // scrollTop=700, scrollHeight=1000, clientHeight=100 → distance = 200
    expect(isNearBottom(700, 1000, 100, 50)).toBe(false);
  });

  it('returns true when exactly at bottom', () => {
    // scrollTop=900, scrollHeight=1000, clientHeight=100 → distance = 0
    expect(isNearBottom(900, 1000, 100, 50)).toBe(true);
  });

  it('returns true when exactly at threshold', () => {
    // distance = 1000 - 850 - 100 = 50, threshold = 50
    expect(isNearBottom(850, 1000, 100, 50)).toBe(true);
  });

  it('returns true at the very top of a short container', () => {
    // Container not scrollable: scrollHeight == clientHeight
    // distance = 500 - 0 - 500 = 0
    expect(isNearBottom(0, 500, 500, 50)).toBe(true);
  });

  it('returns false when scrolled to top of long content', () => {
    // scrollTop=0, scrollHeight=10000, clientHeight=500 → distance = 9500
    expect(isNearBottom(0, 10000, 500, 100)).toBe(false);
  });

  it('handles zero threshold', () => {
    // Must be exactly at bottom
    expect(isNearBottom(900, 1000, 100, 0)).toBe(true);
    expect(isNearBottom(899, 1000, 100, 0)).toBe(false);
  });

  it('handles large threshold', () => {
    // threshold larger than scrollable area → always at bottom
    expect(isNearBottom(0, 1000, 100, 1000)).toBe(true);
  });
});
