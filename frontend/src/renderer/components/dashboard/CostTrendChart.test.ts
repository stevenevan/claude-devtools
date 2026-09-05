import { describe, expect, test } from 'bun:test';

import { downsampleCostBuckets, MAX_COST_TREND_POINTS } from './CostTrendChart';

import type { TimeBucketUsage } from '@shared/types';

function bucket(index: number): TimeBucketUsage {
  return {
    key: `2026-${index}`,
    label: `Day ${index}`,
    totalTokens: 100,
    inputTokens: 60,
    outputTokens: 30,
    cacheReadTokens: 10,
    costUsd: 1.5,
    sessionCount: 2,
  };
}

describe('cost trend downsampling', () => {
  test('caps a year of daily buckets while preserving totals', () => {
    const year = Array.from({ length: 365 }, (_, index) => bucket(index));
    const capped = downsampleCostBuckets(year);

    expect(capped.length).toBeLessThanOrEqual(MAX_COST_TREND_POINTS);
    expect(capped.length).toBeGreaterThan(0);
    const totalCost = capped.reduce((sum, entry) => sum + entry.costUsd, 0);
    expect(totalCost).toBeCloseTo(365 * 1.5, 6);
    const totalSessions = capped.reduce((sum, entry) => sum + entry.sessionCount, 0);
    expect(totalSessions).toBe(365 * 2);
    expect(capped[0]?.label).toContain('Day 0');
  });

  test('leaves small series untouched', () => {
    const small = [bucket(0), bucket(1), bucket(2)];
    expect(downsampleCostBuckets(small)).toEqual(small);
    expect(downsampleCostBuckets([])).toEqual([]);
  });
});
