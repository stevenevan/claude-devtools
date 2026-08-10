import { expect, test } from 'bun:test';

import {
  buildCostBreakdown,
  formatMonthLabel,
  getBudgetPercentage,
  getCostPeriodState,
  getMonthOverMonthMessage,
  getMonthlyLimitSetupState,
  parseMonthlyBudgetCents,
} from './CostSummary';

import type { SimpleCostCompleteness, SimpleCostPeriod, SimpleCostProjectTotal } from '@shared/types';

function completeness(overrides: Partial<SimpleCostCompleteness> = {}): SimpleCostCompleteness {
  return {
    isComplete: true,
    activityCount: 2,
    priceableActivityCount: 2,
    unpriceableActivityCount: 0,
    diagnostics: [],
    ...overrides,
  };
}

function period(
  month: string,
  approximateCostUsd: number,
  overrides: Partial<SimpleCostCompleteness> = {}
): SimpleCostPeriod {
  return {
    month,
    approximateCostUsd,
    completeness: completeness(overrides),
  };
}

function project(projectName: string, approximateCostUsd: number): SimpleCostProjectTotal {
  return { projectName, approximateCostUsd };
}

test('keeps Simple cost data isolated from Nerd analytics fetching', async () => {
  const dashboardSource = await Bun.file(
    new URL('./AnalyticsDashboard/index.tsx', import.meta.url)
  ).text();
  const costSource = await Bun.file(new URL('./CostSummary.tsx', import.meta.url)).text();
  const nerdStart = dashboardSource.indexOf('const NerdAnalyticsDashboard');

  expect(nerdStart).toBeGreaterThan(-1);
  expect(dashboardSource.slice(0, nerdStart)).not.toContain('useAnalyticsData()');
  expect(dashboardSource.slice(nerdStart)).toContain('useAnalyticsData()');
  expect(costSource).toContain('.getSimpleCostSummary()');
  expect(costSource).not.toContain('getAnalytics');
});

test('uses one semantic heading and keeps token vocabulary out of Simple cost', async () => {
  const source = await Bun.file(new URL('./CostSummary.tsx', import.meta.url)).text();

  expect(source.match(/<h1\b/g)?.length ?? 0).toBe(1);
  expect(source.match(/<h2\b/g)?.length ?? 0).toBeGreaterThan(0);
  expect(source.toLowerCase()).not.toContain('token');
});

test('presents complete calendar month comparisons without dividing by zero', () => {
  const message = getMonthOverMonthMessage(period('2026-08', 12), period('2026-07', 10));

  expect(formatMonthLabel('2026-08')).toBe('August 2026');
  expect(message).toBe(
    'Current month is about $12.00, up 20.0% from about $10.00 in July 2026.'
  );
  expect(getMonthOverMonthMessage(period('2026-08', 12), period('2026-07', 0))).toContain(
    'percentage comparison'
  );
  expect(
    getMonthOverMonthMessage(period('2026-08', 12, { isComplete: false }), period('2026-07', 10))
  ).toBeNull();
});

test('aggregates the top three folders and everything else', () => {
  const totals = [
    project('alpha', 12),
    project('beta', 9),
    project('gamma', 7),
    project('delta', 5),
    project('epsilon', 3),
  ];

  expect(buildCostBreakdown(totals)).toEqual([
    { label: 'alpha', approximateCostUsd: 12 },
    { label: 'beta', approximateCostUsd: 9 },
    { label: 'gamma', approximateCostUsd: 7 },
    { label: 'Everything else', approximateCostUsd: 8 },
  ]);
});

test('distinguishes complete, incomplete, unpriceable, and no-data periods', () => {
  expect(getCostPeriodState(period('2026-08', 4))).toBe('complete');
  expect(
    getCostPeriodState(
      period('2026-08', 4, {
        isComplete: false,
        priceableActivityCount: 1,
        unpriceableActivityCount: 1,
      })
    )
  ).toBe('incomplete');
  expect(
    getCostPeriodState(
      period('2026-08', 0, {
        isComplete: false,
        activityCount: 1,
        priceableActivityCount: 0,
        unpriceableActivityCount: 1,
      })
    )
  ).toBe('unpriceable');
  expect(
    getCostPeriodState(
      period('2026-08', 0, {
        activityCount: 0,
        priceableActivityCount: 0,
      })
    )
  ).toBe('empty');
});

test('validates monthly limits at integer-cent boundaries and computes percentage', () => {
  expect(parseMonthlyBudgetCents('0.01')).toBe(1);
  expect(parseMonthlyBudgetCents('1000000.00')).toBe(100_000_000);
  expect(parseMonthlyBudgetCents('.50')).toBe(50);
  expect(parseMonthlyBudgetCents('1.234')).toBeNull();
  expect(parseMonthlyBudgetCents('0')).toBeNull();
  expect(parseMonthlyBudgetCents('1000000.01')).toBeNull();
  expect(parseMonthlyBudgetCents('1e2')).toBeNull();
  expect(getBudgetPercentage(25, 10_000)).toBe(25);
  expect(getBudgetPercentage(12.5, 10_000)).toBe(12.5);
});

test('lets dismissed monthly-limit setup re-enter until a limit is configured', () => {
  expect(getMonthlyLimitSetupState(null, false)).toBe('form');
  expect(getMonthlyLimitSetupState(null, true)).toBe('trigger');
  expect(getMonthlyLimitSetupState(10_000, true)).toBe('configured');
  expect(getMonthlyLimitSetupState(null, false)).toBe('form');
});
