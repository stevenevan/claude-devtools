import { JSX, type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@renderer/components/ui/field';
import { api } from '@renderer/api';
import { useStore } from '@renderer/store';
import { createLogger } from '@shared/utils/logger';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { formatCost } from './dashboardFormatters';

import type {
  AppConfig,
  SimpleCostDailyPoint,
  SimpleCostPeriod,
  SimpleCostProjectTotal,
  SimpleCostSummary,
} from '@shared/types';

const logger = createLogger('Component:CostSummary');

const MIN_MONTHLY_BUDGET_CENTS = 1;
const MAX_MONTHLY_BUDGET_CENTS = 100_000_000;

type CostPeriodState = 'complete' | 'incomplete' | 'unpriceable' | 'empty';

export interface CostBreakdownEntry {
  label: string;
  approximateCostUsd: number;
}

export function formatMonthLabel(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  const yearText = match?.[1];
  const monthText = match?.[2];
  if (!yearText || !monthText) return month;

  const monthNumber = Number(monthText);
  if (monthNumber < 1 || monthNumber > 12) return month;

  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(Date.UTC(Number(yearText), monthNumber - 1, 1)));
}

function formatDayLabel(date: string): string {
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(timestamp)) return date;
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(timestamp));
}

export function parseMonthlyBudgetCents(input: string): number | null {
  const value = input.trim();
  const standard = /^(\d+)(?:\.(\d{0,2}))?$/.exec(value);
  const leadingDecimal = /^\.(\d{1,2})$/.exec(value);
  if (!standard && !leadingDecimal) return null;

  const wholeText = standard?.[1] ?? '0';
  const fractionText = standard?.[2] ?? leadingDecimal?.[1] ?? '';
  const whole = Number(wholeText);
  if (!Number.isSafeInteger(whole) || whole > MAX_MONTHLY_BUDGET_CENTS / 100) return null;

  const cents = whole * 100 + Number(fractionText.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return null;
  if (cents < MIN_MONTHLY_BUDGET_CENTS || cents > MAX_MONTHLY_BUDGET_CENTS) return null;
  return cents;
}

export function getMonthlyBudgetCents(appConfig: AppConfig | null): number | null {
  const cents = appConfig?.dashboard?.monthlyBudgetCents;
  if (cents == null) return null;
  if (!Number.isInteger(cents)) return null;
  if (cents < MIN_MONTHLY_BUDGET_CENTS || cents > MAX_MONTHLY_BUDGET_CENTS) return null;
  return cents;
}

export function getBudgetPercentage(costUsd: number, monthlyBudgetCents: number): number | null {
  if (!Number.isFinite(costUsd)) return null;
  if (!Number.isInteger(monthlyBudgetCents)) return null;
  if (monthlyBudgetCents < MIN_MONTHLY_BUDGET_CENTS) return null;
  if (monthlyBudgetCents > MAX_MONTHLY_BUDGET_CENTS) return null;

  const percentage = (costUsd / (monthlyBudgetCents / 100)) * 100;
  return Number.isFinite(percentage) ? percentage : null;
}

export function getCostPeriodState(period: SimpleCostPeriod): CostPeriodState {
  if (!Number.isFinite(period.approximateCostUsd)) return 'unpriceable';
  if (period.completeness.isComplete && period.completeness.activityCount === 0) return 'empty';
  if (!period.completeness.isComplete && period.completeness.priceableActivityCount === 0) {
    return 'unpriceable';
  }
  if (!period.completeness.isComplete) return 'incomplete';
  return 'complete';
}

export function buildCostBreakdown(
  projectTotals: ReadonlyArray<SimpleCostProjectTotal>
): CostBreakdownEntry[] {
  const totalsByFolder = new Map<string, number>();
  for (const total of projectTotals) {
    if (!Number.isFinite(total.approximateCostUsd)) continue;
    const label = total.projectName.trim() || 'Unnamed folder';
    const next = (totalsByFolder.get(label) ?? 0) + total.approximateCostUsd;
    if (Number.isFinite(next)) totalsByFolder.set(label, next);
  }

  const sorted = Array.from(totalsByFolder, ([label, approximateCostUsd]) => ({
    label,
    approximateCostUsd,
  })).sort(
    (left, right) =>
      right.approximateCostUsd - left.approximateCostUsd || left.label.localeCompare(right.label)
  );
  const topFolders = sorted.slice(0, 3);
  if (sorted.length <= 3) return topFolders;

  const everythingElse = sorted
    .slice(3)
    .reduce((sum, entry) => sum + entry.approximateCostUsd, 0);
  return [...topFolders, { label: 'Everything else', approximateCostUsd: everythingElse }];
}

export function getMonthOverMonthMessage(
  current: SimpleCostPeriod,
  previous: SimpleCostPeriod
): string | null {
  if (!current.completeness.isComplete || !previous.completeness.isComplete) return null;
  if (!Number.isFinite(current.approximateCostUsd) || !Number.isFinite(previous.approximateCostUsd)) {
    return null;
  }

  const previousLabel = formatMonthLabel(previous.month);
  if (previous.approximateCostUsd <= 0) {
    return `No previous-month cost is available in ${previousLabel} for a percentage comparison.`;
  }

  const change =
    ((current.approximateCostUsd - previous.approximateCostUsd) / previous.approximateCostUsd) * 100;
  if (!Number.isFinite(change)) return null;
  if (change === 0) {
    return `Current month is about ${formatCost(current.approximateCostUsd)}, unchanged from about ${formatCost(previous.approximateCostUsd)} in ${previousLabel}.`;
  }

  const direction = change > 0 ? 'up' : 'down';
  return `Current month is about ${formatCost(current.approximateCostUsd)}, ${direction} ${Math.abs(change).toFixed(1)}% from about ${formatCost(previous.approximateCostUsd)} in ${previousLabel}.`;
}

export type MonthlyLimitSetupState = 'configured' | 'form' | 'trigger';

export function getMonthlyLimitSetupState(
  monthlyBudgetCents: number | null,
  isDismissed: boolean
): MonthlyLimitSetupState {
  if (monthlyBudgetCents !== null) return 'configured';
  return isDismissed ? 'trigger' : 'form';
}

function getCurrentCostPresentation(period: SimpleCostPeriod): {
  figure: string;
  caption: string;
} {
  const monthLabel = formatMonthLabel(period.month);
  const state = getCostPeriodState(period);

  if (state === 'unpriceable') {
    return {
      figure: '—',
      caption: `Cost unavailable for ${monthLabel}; activity was found, but none could be priced.`,
    };
  }
  if (state === 'empty') {
    return {
      figure: `about ${formatCost(0)}`,
      caption: `No priced activity recorded in ${monthLabel}.`,
    };
  }
  if (state === 'incomplete') {
    return {
      figure: `about ${formatCost(period.approximateCostUsd)}`,
      caption: `Incomplete cost data for ${monthLabel}; showing known priced activity only.`,
    };
  }
  return {
    figure: `about ${formatCost(period.approximateCostUsd)}`,
    caption: `Approximate spend for ${monthLabel}.`,
  };
}

const CostPageFrame = ({ children }: Readonly<{ children: ReactNode }>): JSX.Element => (
  <div className="bg-background relative flex-1 overflow-auto">
    <div className="relative mx-auto max-w-5xl px-6 py-8 sm:px-8 sm:py-12">{children}</div>
  </div>
);

const CostPageHeader = (): JSX.Element => (
  <header className="mb-8">
    <h1 className="text-text text-lg font-semibold">Cost</h1>
    <p className="text-text-muted mt-1 text-xs">Approximate spend by calendar month and folder</p>
  </header>
);

interface CostChartProps {
  points: SimpleCostDailyPoint[];
}

interface CostTooltipProps {
  active?: boolean;
  payload?: { payload: SimpleCostDailyPoint }[];
}

const CostTooltip = ({ active, payload }: Readonly<CostTooltipProps>): JSX.Element | null => {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="border-border bg-surface-overlay rounded-xs border px-3 py-2 text-xs shadow-lg">
      <p className="text-text font-medium">{formatDayLabel(point.date)}</p>
      <p className="text-text-secondary mt-1">about {formatCost(point.approximateCostUsd)}</p>
    </div>
  );
};

const CostChart = ({ points }: Readonly<CostChartProps>): JSX.Element => (
  <div
    className="h-56 w-full"
    role="img"
    aria-label="Approximate daily cost chart for the current calendar month"
  >
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: '#71717a' }}
          axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
          tickLine={false}
          minTickGap={16}
          tickFormatter={formatDayLabel}
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#71717a' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={formatCost}
          width={48}
        />
        <Tooltip content={<CostTooltip />} />
        <Line
          type="monotone"
          dataKey="approximateCostUsd"
          name="Approximate cost"
          stroke="#10b981"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  </div>
);

interface MonthlyLimitControlProps {
  currentPeriod: SimpleCostPeriod;
}

const MonthlyLimitControl = ({ currentPeriod }: Readonly<MonthlyLimitControlProps>): JSX.Element => {
  const appConfig = useStore((state) => state.appConfig);
  const updateConfig = useStore((state) => state.updateConfig);
  const [limitInput, setLimitInput] = useState('');
  const [isDismissed, setIsDismissed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [limitError, setLimitError] = useState<string | null>(null);
  const monthlyBudgetCents = getMonthlyBudgetCents(appConfig);
  const setupState = getMonthlyLimitSetupState(monthlyBudgetCents, isDismissed);
  const budgetPercentage =
    monthlyBudgetCents !== null && currentPeriod.completeness.isComplete
      ? getBudgetPercentage(currentPeriod.approximateCostUsd, monthlyBudgetCents)
      : null;

  const handleSave = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const cents = parseMonthlyBudgetCents(limitInput);
    if (cents === null) {
      setLimitError('Enter a monthly limit from $0.01 to $1,000,000.00 with up to two decimals.');
      return;
    }

    setIsSaving(true);
    setLimitError(null);
    await updateConfig('dashboard', { monthlyBudgetCents: cents });
    const savedCents = getMonthlyBudgetCents(useStore.getState().appConfig);
    if (savedCents === cents) {
      setLimitInput('');
      setIsDismissed(false);
    } else {
      setLimitError(
        useStore.getState().configError ?? 'Monthly limit could not be saved. Try again.'
      );
    }
    setIsSaving(false);
  };

  const handleClear = async (): Promise<void> => {
    setIsSaving(true);
    setLimitError(null);
    await updateConfig('dashboard', { monthlyBudgetCents: null });
    const savedCents = getMonthlyBudgetCents(useStore.getState().appConfig);
    if (savedCents === null) {
      setIsDismissed(true);
    } else {
      setLimitError(
        useStore.getState().configError ?? 'Monthly limit could not be cleared. Try again.'
      );
    }
    setIsSaving(false);
  };

  return (
    <section
      className="border-border bg-background/50 rounded-xs border p-4"
      aria-labelledby="monthly-limit-heading"
    >
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 id="monthly-limit-heading" className="text-text text-sm font-medium">
            Monthly limit
          </h2>
          <p className="text-text-muted mt-0.5 text-[10px]">
            Optional spending target for the current calendar month
          </p>
        </div>
        {setupState === 'configured' && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void handleClear()}
            disabled={isSaving}
            className="text-text-muted h-6 px-2 text-[10px]"
          >
            Clear limit
          </Button>
        )}
      </div>

      {setupState === 'configured' && monthlyBudgetCents !== null ? (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
          <span className="text-text font-medium tabular-nums">
            {formatCost(monthlyBudgetCents / 100)}
          </span>
          {budgetPercentage === null ? (
            <span className="text-text-muted">
              Current-month comparison is unavailable while cost data is incomplete.
            </span>
          ) : (
            <span className="text-text-secondary tabular-nums">
              about {budgetPercentage.toFixed(0)}% used
            </span>
          )}
        </div>
      ) : setupState === 'form' ? (
        <form className="flex flex-col gap-3" onSubmit={(event) => void handleSave(event)}>
          <Field invalid={Boolean(limitError)} className="gap-1">
            <FieldLabel htmlFor="monthly-limit-input" className="text-text-secondary text-xs">
              Monthly limit in USD
            </FieldLabel>
            <input
              id="monthly-limit-input"
              name="monthlyLimit"
              type="number"
              min="0.01"
              max="1000000"
              step="0.01"
              inputMode="decimal"
              value={limitInput}
              onChange={(event) => {
                setLimitInput(event.target.value);
                setLimitError(null);
              }}
              placeholder="100.00"
              aria-describedby={`monthly-limit-help${limitError ? ' monthly-limit-error' : ''}`}
              aria-invalid={limitError !== null}
              disabled={isSaving}
              className="border-border bg-surface-raised text-text placeholder:text-text-muted h-8 w-full max-w-48 rounded-xs border px-2 text-xs outline-hidden focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            />
            <FieldDescription id="monthly-limit-help" className="text-text-muted text-[10px]">
              Use up to two decimal places.
            </FieldDescription>
            {limitError && (
              <FieldError id="monthly-limit-error" match role="alert" className="text-[10px]">
                {limitError}
              </FieldError>
            )}
          </Field>
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save limit'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsDismissed(true);
                setLimitError(null);
              }}
              disabled={isSaving}
              className="text-text-muted"
            >
              Not now
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setIsDismissed(false)}
          className="text-text-secondary px-0 hover:bg-transparent hover:text-text"
        >
          Set monthly limit
        </Button>
      )}

    </section>
  );
};

export const CostSummary = (): JSX.Element => {
  const [summary, setSummary] = useState<SimpleCostSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .getSimpleCostSummary()
      .then((result) => {
        if (!cancelled) setSummary(result);
      })
      .catch((err: unknown) => {
        logger.error('Failed to load simple cost summary', err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load cost data');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <CostPageFrame>
        <CostPageHeader />
        <div className="space-y-6" aria-busy="true" aria-live="polite">
          <div className="border-border bg-background/50 animate-pulse rounded-xs border p-5">
            <div className="bg-muted-foreground/10 mb-3 h-3 w-24 rounded-xs" />
            <div className="bg-muted-foreground/5 h-10 w-32 rounded-xs" />
          </div>
          <div className="border-border bg-background/50 animate-pulse rounded-xs border p-4">
            <div className="bg-muted-foreground/10 h-48 rounded-xs" />
          </div>
        </div>
      </CostPageFrame>
    );
  }

  if (error || !summary) {
    return (
      <CostPageFrame>
        <CostPageHeader />
        <section className="border-border bg-background/50 rounded-xs border p-5" role="alert">
          <h2 className="text-text text-sm font-medium">Cost data unavailable</h2>
          <p className="text-text-muted mt-2 text-xs">{error ?? 'No cost summary is available.'}</p>
        </section>
      </CostPageFrame>
    );
  }

  const current = summary.currentMonth;
  const previous = summary.previousMonth;
  const currentState = getCostPeriodState(current);
  const presentation = getCurrentCostPresentation(current);
  const comparisonMessage = getMonthOverMonthMessage(current, previous);
  const chartPoints = summary.currentMonthDailyPoints.filter((point) =>
    Number.isFinite(point.approximateCostUsd)
  );
  const hasChartData = current.completeness.priceableActivityCount > 0 && chartPoints.length > 0;
  const breakdown = buildCostBreakdown(summary.currentMonthProjectTotals);

  return (
    <CostPageFrame>
      <CostPageHeader />

      <div className="space-y-6">
        <section
          className="border-border bg-background/50 rounded-xs border p-5"
          aria-labelledby="current-cost-heading"
        >
          <h2 id="current-cost-heading" className="text-text text-sm font-medium">
            Current month · {formatMonthLabel(current.month)}
          </h2>
          <figure className="mt-3">
            <p className="text-text text-4xl font-semibold tracking-tight tabular-nums">
              {presentation.figure}
            </p>
            <figcaption className="text-text-muted mt-1 text-xs">{presentation.caption}</figcaption>
          </figure>
          {comparisonMessage && (
            <p className="text-text-secondary mt-4 text-xs" aria-live="polite">
              {comparisonMessage}
            </p>
          )}
        </section>

        <section
          className="border-border bg-background/50 rounded-xs border p-4"
          aria-labelledby="cost-trend-heading"
        >
          <div className="mb-4">
            <h2 id="cost-trend-heading" className="text-text text-sm font-medium">
              Daily cost
            </h2>
            <p className="text-text-muted mt-0.5 text-[10px]">
              {currentState === 'incomplete'
                ? 'Incomplete data · known priced activity by calendar day'
                : 'Approximate cost by calendar day'}
            </p>
          </div>
          {hasChartData ? (
            <CostChart points={chartPoints} />
          ) : (
            <p className="text-text-muted py-12 text-center text-xs">
              {currentState === 'unpriceable'
                ? 'No priced cost data is available to chart this month.'
                : 'No cost data is available to chart this month.'}
            </p>
          )}
        </section>

        <section
          className="border-border bg-background/50 rounded-xs border p-4"
          aria-labelledby="cost-breakdown-heading"
        >
          <div className="mb-4">
            <h2 id="cost-breakdown-heading" className="text-text text-sm font-medium">
              Where it went
            </h2>
            <p className="text-text-muted mt-0.5 text-[10px]">
              {currentState === 'incomplete'
                ? 'Top folders by known priced current-month cost'
                : 'Top folders by approximate current-month cost'}
            </p>
          </div>
          {breakdown.length === 0 ? (
            <p className="text-text-muted py-4 text-center text-xs">
              No folder cost data is available this month.
            </p>
          ) : (
            <ul className="divide-border/40 divide-y">
              {breakdown.map((entry) => (
                <li
                  key={entry.label}
                  className="flex items-center justify-between gap-4 py-2 text-xs first:pt-0 last:pb-0"
                >
                  <span className="text-text min-w-0 truncate">{entry.label}</span>
                  <span className="text-text-secondary shrink-0 tabular-nums">
                    about {formatCost(entry.approximateCostUsd)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <MonthlyLimitControl currentPeriod={current} />
      </div>
    </CostPageFrame>
  );
};
