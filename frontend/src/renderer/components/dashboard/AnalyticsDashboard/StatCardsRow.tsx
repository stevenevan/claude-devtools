
import { JSX } from 'react';
import type { TimeBucketUsage } from '@shared/types';
import { formatTokensCompact } from '@shared/utils/tokenFormatting';
import { Activity, Clock, DollarSign, TrendingUp, Zap } from 'lucide-react';

import { StatCard } from '../analyticsDashboardHelpers';
import { formatCost } from '../dashboardFormatters';

interface StatCardsRowProps {
  totalTokens: number;
  totalCost: number;
  totalSessions: number;
  avgTokensPerSession: number;
  avgCostPerSession: number;
  peakBucket: TimeBucketUsage | null;
  peakLabel: string;
  activeBuckets: number;
  bucketNoun: string;
  projectCount: number;
}

export const StatCardsRow = ({
  totalTokens,
  totalCost,
  totalSessions,
  avgTokensPerSession,
  avgCostPerSession,
  peakBucket,
  peakLabel,
  activeBuckets,
  bucketNoun,
  projectCount,
}: StatCardsRowProps): JSX.Element => {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
      <StatCard
        label="Total Tokens"
        value={formatTokensCompact(totalTokens)}
        subtitle={`${activeBuckets} active ${bucketNoun}${activeBuckets !== 1 ? 's' : ''}`}
        icon={Zap}
        accentColor="#6366f1"
      />
      <StatCard
        label="Total Cost"
        value={formatCost(totalCost)}
        subtitle={`Avg ${formatCost(avgCostPerSession)}/session`}
        icon={DollarSign}
        accentColor="#10b981"
      />
      <StatCard
        label="Sessions"
        value={totalSessions.toString()}
        subtitle={`${projectCount} project${projectCount !== 1 ? 's' : ''}`}
        icon={Activity}
        accentColor="#8b5cf6"
      />
      <StatCard
        label="Avg Tokens/Session"
        value={formatTokensCompact(avgTokensPerSession)}
        icon={TrendingUp}
        accentColor="#f59e0b"
      />
      <StatCard
        label={peakLabel}
        value={peakBucket ? formatTokensCompact(peakBucket.totalTokens) : '-'}
        subtitle={peakBucket?.label}
        icon={Clock}
        accentColor="#ec4899"
      />
    </div>
  );
};
