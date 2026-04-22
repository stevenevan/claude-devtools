import { useEffect, useState } from 'react';

import { api } from '@renderer/api';
import { cn } from '@renderer/lib/utils';
import { createLogger } from '@shared/utils/logger';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';

import type { CostForecast } from '@shared/types';

import { registerDashboardWidget } from './widgetContract';

const logger = createLogger('Component:BudgetPanel');

const FORECAST_WINDOW_DAYS = 14;

registerDashboardWidget({
  id: 'budget-panel',
  title: 'Budget & Forecast',
  category: 'analytics',
  defaultSize: { cols: 4, rows: 1 },
  minSize: { cols: 2, rows: 1 },
  maxSize: { cols: 6, rows: 2 },
  defaultVisible: true,
});

function formatUsd(usd: number): string {
  if (usd >= 100) return `$${usd.toFixed(0)}`;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(3)}`;
}

interface TrendIndicatorProps {
  slope: number;
}

const TrendIndicator = ({ slope }: Readonly<TrendIndicatorProps>): React.JSX.Element => {
  const absSlope = Math.abs(slope);
  const label = `${slope >= 0 ? '+' : '-'}${formatUsd(absSlope)}/day`;

  if (absSlope < 0.005) {
    return (
      <span className="text-text-muted inline-flex items-center gap-1 text-[10px]">
        <Minus className="size-3" />
        flat
      </span>
    );
  }

  const Icon = slope > 0 ? TrendingUp : TrendingDown;
  const tone = slope > 0 ? 'text-amber-400' : 'text-emerald-400';

  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px]', tone)}>
      <Icon className="size-3" />
      {label}
    </span>
  );
};

export const BudgetPanel = (): React.JSX.Element => {
  const [forecast, setForecast] = useState<CostForecast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getCostForecast(FORECAST_WINDOW_DAYS)
      .then((result) => {
        if (!cancelled) {
          setForecast(result);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        logger.error('Failed to load cost forecast', err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const currentSpend =
    forecast?.recentDailyCosts.reduce((sum, c) => sum + c, 0) ?? 0;
  const projectedDaily = forecast?.projectedDailyCostUsd ?? 0;
  const projectedWeekly = forecast?.projectedWeeklyCostUsd ?? 0;
  const slope = forecast?.trendSlopeUsdPerDay ?? 0;

  if (loading) {
    return (
      <div className="border-border bg-background/50 animate-pulse rounded-xs border p-4">
        <div className="bg-muted-foreground/10 mb-2 h-3 w-24 rounded-xs" />
        <div className="bg-muted-foreground/5 h-6 w-16 rounded-xs" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="border-border bg-background/50 rounded-xs border p-4">
        <p className="text-text-muted text-[11px]">Budget & Forecast</p>
        <p className="text-text-muted mt-2 text-[10px]">Forecast unavailable: {error}</p>
      </div>
    );
  }

  return (
    <div className="border-border bg-background/50 rounded-xs border p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-text text-sm font-medium">Budget & Forecast</h3>
          <p className="text-text-muted mt-0.5 text-[10px]">
            Trailing {FORECAST_WINDOW_DAYS} days · linear projection
          </p>
        </div>
        <TrendIndicator slope={slope} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="text-text-muted text-[10px]">Current ({FORECAST_WINDOW_DAYS}d)</p>
          <p className="text-text mt-1 text-lg font-medium tabular-nums">
            {formatUsd(currentSpend)}
          </p>
        </div>
        <div>
          <p className="text-text-muted text-[10px]">Projected daily</p>
          <p className="text-text mt-1 text-lg font-medium tabular-nums">
            {formatUsd(projectedDaily)}
          </p>
        </div>
        <div>
          <p className="text-text-muted text-[10px]">Projected weekly</p>
          <p className="text-text mt-1 text-lg font-medium tabular-nums">
            {formatUsd(projectedWeekly)}
          </p>
        </div>
      </div>
    </div>
  );
};
