import React from 'react';

import type { TopSessionEntry } from '@shared/types';
import { formatTokensCompact } from '@shared/utils/tokenFormatting';
import { Cpu } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import type { ModelUsage, ProjectUsage } from '@renderer/hooks/useAnalyticsData';

import { ChartSection, CustomPieTooltip, TopSessions } from '../analyticsDashboardHelpers';
import { formatCost } from '../dashboardFormatters';

interface DistributionChartsProps {
  projectUsage: ProjectUsage[];
  modelUsage: ModelUsage[];
  topSessions: TopSessionEntry[];
}

export const DistributionCharts = ({
  projectUsage,
  modelUsage,
  topSessions,
}: DistributionChartsProps): React.JSX.Element => {
  return (
    <div className="mb-6 grid gap-6 lg:grid-cols-3">
      <ChartSection title="By Project" subtitle="Token distribution across projects">
        {projectUsage.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-text-muted text-xs">No project data</p>
          </div>
        ) : (
          <div>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={projectUsage}
                  dataKey="totalTokens"
                  nameKey="projectName"
                  cx="50%"
                  cy="50%"
                  innerRadius={35}
                  outerRadius={70}
                  strokeWidth={1}
                  stroke="rgba(0,0,0,0.3)"
                >
                  {projectUsage.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomPieTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="mt-2 space-y-1">
              {projectUsage.slice(0, 6).map((proj) => (
                <div key={proj.projectName} className="flex items-center gap-2">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: proj.color }}
                  />
                  <span className="text-text min-w-0 flex-1 truncate text-[10px]">
                    {proj.projectName}
                  </span>
                  <span className="text-text-muted shrink-0 text-[9px]">
                    {formatTokensCompact(proj.totalTokens)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </ChartSection>

      <ChartSection title="By Model" subtitle="Token distribution across models">
        {modelUsage.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div
                className="border-border mx-auto mb-2 flex size-8 items-center justify-center rounded-xs border"
                style={{ backgroundColor: '#f59e0b10', color: '#f59e0b' }}
              >
                <Cpu className="size-4" />
              </div>
              <p className="text-text-muted text-xs">No model data</p>
            </div>
          </div>
        ) : (
          <div>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={modelUsage}
                  dataKey="totalTokens"
                  nameKey="displayName"
                  cx="50%"
                  cy="50%"
                  innerRadius={35}
                  outerRadius={70}
                  strokeWidth={1}
                  stroke="rgba(0,0,0,0.3)"
                >
                  {modelUsage.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomPieTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="mt-2 space-y-1">
              {modelUsage.map((m) => (
                <div key={m.model} className="flex items-center gap-2">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: m.color }}
                  />
                  <span className="text-text min-w-0 flex-1 truncate text-[10px]">
                    {m.displayName}
                  </span>
                  <span className="text-text-muted shrink-0 text-[9px]">
                    {formatTokensCompact(m.totalTokens)} &middot; {formatCost(m.costUsd)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </ChartSection>

      <ChartSection title="Top Sessions" subtitle="Most token-intensive sessions">
        <TopSessions sessions={topSessions} />
      </ChartSection>
    </div>
  );
};
