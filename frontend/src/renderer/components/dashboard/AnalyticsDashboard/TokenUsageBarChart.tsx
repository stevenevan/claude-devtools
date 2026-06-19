import React from 'react';

import type { TimeBucketUsage } from '@shared/types';
import { formatTokensCompact } from '@shared/utils/tokenFormatting';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { ChartSection, CustomBarTooltip } from '../analyticsDashboardHelpers';

interface TokenUsageBarChartProps {
  timeBuckets: TimeBucketUsage[];
  bucketNoun: string;
  xAxisInterval: number;
}

export const TokenUsageBarChart = ({
  timeBuckets,
  bucketNoun,
  xAxisInterval,
}: TokenUsageBarChartProps): React.JSX.Element => {
  return (
    <ChartSection
      title="Token Usage Over Time"
      subtitle={`Per-${bucketNoun} breakdown of input, output, and cache tokens`}
      className="mb-6"
    >
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={timeBuckets} barCategoryGap="15%">
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: '#71717a' }}
            axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
            tickLine={false}
            interval={xAxisInterval}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#71717a' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => formatTokensCompact(v)}
          />
          <Tooltip content={<CustomBarTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 10 }}
            iconSize={8}
            formatter={(value: string) => <span className="text-text-secondary">{value}</span>}
          />
          <Bar dataKey="inputTokens" name="Input" stackId="tokens" fill="#6366f1" />
          <Bar dataKey="outputTokens" name="Output" stackId="tokens" fill="#8b5cf6" />
          <Bar
            dataKey="cacheReadTokens"
            name="Cache Read"
            stackId="tokens"
            fill="#a78bfa"
            radius={[2, 2, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartSection>
  );
};
