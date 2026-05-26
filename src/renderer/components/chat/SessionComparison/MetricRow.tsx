import React from 'react';

import { cn } from '@renderer/lib/utils';

interface MetricRowProps {
  icon: React.ElementType;
  label: string;
  leftValue: string;
  rightValue: string;
  iconColor?: string;
}

export const MetricRow = ({
  icon: Icon,
  label,
  leftValue,
  rightValue,
  iconColor = 'text-muted-foreground',
}: Readonly<MetricRowProps>): React.JSX.Element => (
  <div className="flex items-center gap-3 py-1.5">
    <Icon className={cn('size-3.5 shrink-0', iconColor)} />
    <span className="text-muted-foreground w-24 shrink-0 text-xs">{label}</span>
    <span className="text-foreground flex-1 text-right text-xs tabular-nums">{leftValue}</span>
    <span className="text-foreground flex-1 text-right text-xs tabular-nums">{rightValue}</span>
  </div>
);
